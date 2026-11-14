"""End-to-end run of the pipeline scripts on a synthetic multi-tile, multi-country archive."""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

import synth  # noqa: E402
from mvh import store  # noqa: E402

STAGES = ["00_prepare_aoi.py", "03_create_grid.py", "02_quality_control.py", "04_aggregate.py",
          "06_harmonize.py", "07_export_web.py"]


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    work = tmp_path_factory.mktemp("synth")
    cfg = synth.make(work, n_sites=90, scale=0.8)
    env = {**os.environ, "MVH_CONFIG": str(cfg)}
    for s in STAGES:
        extra = ["--out", str(work / "web")] if s.startswith("07") else []
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / s), *extra], env=env, capture_output=True, text=True)
        assert r.returncode == 0, f"{s} failed:\n{r.stderr[-3000:]}"
    return work


def test_partitions_and_outage_screening(run):
    assert len(store.tiles(run / "processed" / "detections")) >= 4          # several processing tiles
    o = pd.read_csv(run / "harmonized" / "outages_used.csv")
    snpp = o[o["platform"] == "S-NPP"]
    assert len(snpp) == 1 and snpp["start"].iat[0] == synth.OUTAGE[0] and snpp["end"].iat[0] == synth.OUTAGE[1]
    av = pd.read_csv(run / "harmonized" / "availability.csv", index_col=0, parse_dates=True)
    assert (av.loc[synth.OUTAGE[0]:synth.OUTAGE[1], "config"] == "noaa-20").all()
    assert not av.loc[synth.OUTAGE[0]:synth.OUTAGE[1], "ok_S-NPP"].any()


def test_factors_recover_truth(run):
    ci = pd.read_csv(run / "out" / "csv" / "harm_factors_ci_dn.csv").set_index(["config", "dn"])["f_n"]
    assert abs(ci["noaa-20", "D"] - 1) < 0.05 and abs(ci["noaa-21", "N"] - 1) < 0.08
    assert 1.7 < ci["terra+aqua", "N"] / ci["terra+aqua", "D"] < 2.3          # truth: night factor = 2 × day
    sup = pd.read_csv(run / "out" / "csv" / "harm_factors_ci_super.csv").query("config == 'terra+aqua'").set_index("super")["f_n"]
    assert 1.3 < sup["Northern Africa"] / sup["Southern Europe"] < 1.7        # truth: × 1.5 south of 36°N
    y = pd.read_csv(run / "out" / "csv" / "harm_drift_by_year.csv").query("config == 'terra+aqua'")
    assert y["harm_ratio"].between(0.9, 1.1).all()                            # no drift was simulated
    v = pd.read_csv(run / "out" / "csv" / "harm_validation_daynight.csv")
    assert set(v["daynight"]) == {"split", "pooled"}


def test_series_one_source_per_day_and_nesting(run):
    h5 = pd.concat([store.read_tile(run / "harmonized" / "daily_5km", t) for t in store.tiles(run / "harmonized" / "daily_5km")])
    h1 = pd.concat([store.read_tile(run / "harmonized" / "daily_1km", t) for t in store.tiles(run / "harmonized" / "daily_1km")])
    assert np.isclose(h5["harm_n"].sum(), h1["harm_n"].sum(), rtol=1e-9)
    assert h5.groupby("date")["source"].nunique().max() == 1
    out = h5["date"].between(*synth.OUTAGE)
    assert (h5.loc[out, "source"] == "viirs_backup").all()
    assert (h5.loc[h5["date"] < "2012-01-20", "source"] == "modis_harmonized").all()
    ref = h5["source"] == "viirs"
    assert (h5.loc[ref, "harm_n"] == h5.loc[ref, "n_S-NPP"]).all()
    assert not h5.duplicated(["cell_id", "date"]).any()
    assert h5["f_se"].notna().any()


def test_web_datasets(run):
    idx = json.loads((run / "web" / "datasets.json").read_text())
    assert [d["id"] for d in idx["datasets"]] == ["world", "iberia"] and idx["default"] == "world"
    world, iberia = (run / "web" / d for d in ("world", "iberia"))
    wm, im = (json.loads((d / "meta.json").read_text()) for d in (world, iberia))
    assert wm["cell_size_m"] == 50000 and not wm["points"] and im["cell_size_m"] == 5000 and im["points"]
    assert "Southern Europe" in wm["regions"] and "Spain" in im["regions"]
    assert (iberia / "points_2025.json").exists() and not (world / "points_2025.json").exists()
    # the overview holds the whole harmonized record, re-gridded
    monthly = store.read_all(run / "harmonized" / "monthly_5km")
    cm = json.loads((world / "cells_monthly.json").read_text())
    assert abs(sum(cm["harm"]["v"]) / monthly["harm_n"].sum() - 1) < 0.01
    assert max(cm["harm"]["c"]) < wm["n_cells"] and {"conv", "median"} <= set(cm)
    v = json.loads((iberia / "validation.json").read_text())
    assert v["outages"] and v["test_daynight"] and all(r["region"] in im["regions"] for r in v["factors_region"])


def test_incremental_ingest_is_idempotent(run):
    env = {**os.environ, "MVH_CONFIG": str(run / "config.yaml")}
    before = pd.read_csv(run / "processed" / "qc_summary.csv")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "02_quality_control.py")], env=env, capture_output=True, text=True)
    assert r.returncode == 0 and "ingested 0 new rows" in r.stderr
    pd.testing.assert_frame_equal(before, pd.read_csv(run / "processed" / "qc_summary.csv"))
