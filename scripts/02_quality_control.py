"""Standardize raw FIRMS files, route them to processing tiles, add QC flags.

Every CSV under data/raw/<region>/<SOURCE>/ (sub-folders included) is read in chunks, whatever
its extent (API chunks, yearly archive files per country or for the world): each row gets its
grid cells and goes to the partition of its tile and year. Partitions are then flagged one by one (region lookup, duplicates, QC scenarios).
Files already ingested are skipped, so new downloads only rebuild the partitions they touch.

Outputs (data/processed/):
    detections/<tile>/<year>.parquet   every raw row + cells + QC flags (nothing removed)
    detections/_rejected/...           rows without a valid position or time (flagged, kept)
    qc_summary.csv, ingested.json
"""
import _bootstrap  # noqa: F401

import hashlib
import json
import shutil
from functools import partial

import geopandas as gpd
import numpy as np
import pandas as pd

from mvh import qc, store
from mvh.config import ROOT, cli, load_config, path, raw_dir, setup_logging
from mvh.grid import assign_cells, label, tile_ids
from mvh.regions import RegionIndex

log = setup_logging("02_qc")
_REG: dict = {}


def region_index(cfg) -> RegionIndex:
    if "idx" not in _REG:  # once per worker process
        _REG["idx"] = RegionIndex(gpd.read_file(ROOT / cfg["aoi"]["file"]), cfg["aoi"].get("snap_deg", 0.0))
    return _REG["idx"]


def ingest(cfg, src: dict, f, staging) -> int:
    """Standardize one raw file and append its rows to the staging area of their partitions."""
    sizes = cfg["grid"]["sizes_m"]
    fs = cfg["harmonization"]["factor_scale_m"]
    n = 0
    tag = f"{f.stem}_{hashlib.md5(str(f).encode()).hexdigest()[:8]}"       # same file name in two folders
    for k, raw in enumerate(qc.iter_raw(f, cfg["run"]["chunk_rows"])):
        df = qc.standardize(raw, src, cfg["qc"])
        df = assign_cells(df, cfg["crs"]["equal_area"], sizes)
        cell = df[f"cell_{label(fs)}"].to_numpy()
        year = df["acq_date_utc"].dt.year
        bad = (cell < 0) | year.isna().to_numpy()
        df["_tile"] = np.where(bad, "_rejected", tile_ids(np.where(bad, 0, cell), cfg["grid"]["tile_cells"]))
        df["_year"] = year.fillna(0).astype(int)
        for (t, y), g in df.groupby(["_tile", "_year"]):
            d = staging / t / str(y)
            d.mkdir(parents=True, exist_ok=True)
            g.drop(columns=["_tile", "_year"]).to_parquet(d / f"{src['source']}__{tag}__{k}.parquet", index=False)
        n += len(df)
    return n


def compact(cfg, key) -> pd.DataFrame:
    """Merge staged rows into one partition, flag it, return its QC summary."""
    tile, year = key
    out = path(cfg, "processed")
    stage_dir = out / "_staging" / tile / str(year)
    part = store.part(out / "detections", tile, year)
    frames = [pd.read_parquet(p) for p in sorted(stage_dir.glob("*.parquet"))]
    keep = qc.STD_COLUMNS + [f"cell_{label(s)}" for s in cfg["grid"]["sizes_m"]]
    if part.exists():
        frames.insert(0, pd.read_parquet(part, columns=keep))
    df = pd.concat(frames, ignore_index=True)
    del frames
    reg = region_index(cfg)
    df = qc.add_qc_flags(df, cfg, aoi_region=reg.lookup, clip=cfg["aoi"].get("clip", True), inplace=True)
    df["region"] = df["region"].astype("category")
    tmp = part.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(part)
    shutil.rmtree(stage_dir, ignore_errors=True)
    return qc.qc_summary(df, list(cfg["qc"]["scenarios"]))


def summarize(cfg, key) -> pd.DataFrame:
    cols = ["sensor", "platform", "f_duplicate", "f_coord_ok", "f_time_ok", "f_platform_ok", "f_type_ok", "f_in_aoi",
            "f_base_ok"] + [f"q_{s}" for s in cfg["qc"]["scenarios"]]
    df = store.read(path(cfg, "processed") / "detections", *key, columns=cols)
    return qc.qc_summary(df, list(cfg["qc"]["scenarios"]))


def main():
    args = cli(__doc__).parse_args()
    cfg = load_config(args.config)
    jobs = args.jobs or cfg["run"].get("jobs", 1)
    raw_root = raw_dir(cfg)
    out = path(cfg, "processed")
    staging, det = out / "_staging", out / "detections"
    if args.force:
        for d in (staging, det):
            shutil.rmtree(d, ignore_errors=True)
        (out / "ingested.json").unlink(missing_ok=True)

    sources = {s["source"]: s for s in cfg["firms"]["sources"]}
    for sp, nrt in cfg["firms"].get("nrt_fallback", {}).items():
        sources.setdefault(nrt, {**sources[sp], "source": nrt})

    mf = out / "ingested.json"
    done = json.loads(mf.read_text()) if mf.exists() else {}
    n_new = 0
    for sid, src in sources.items():
        files = [f for f in sorted((raw_root / sid).rglob("*.csv")) if f.stat().st_size > 0]
        key = lambda f: f"{sid}/{f.relative_to(raw_root / sid).as_posix()}"  # noqa: E731
        todo = [f for f in files if done.get(key(f)) != f.stat().st_size]
        if not files:
            continue
        log.info("%s: %d raw files, %d new", sid, len(files), len(todo))
        for k, f in enumerate(todo, 1):
            n_new += ingest(cfg, src, f, staging)
            done[key(f)] = f.stat().st_size
            if k % 200 == 0:
                mf.write_text(json.dumps(done))
                log.info("  %s %d/%d", sid, k, len(todo))
        mf.write_text(json.dumps(done))
    if not done:
        raise SystemExit(f"no raw data found under {raw_root} — run 01_download_data.py first")
    log.info("ingested %d new rows", n_new)

    keys = sorted((t.name, int(y.name)) for t in staging.glob("*") for y in t.glob("*") if any(y.glob("*.parquet")))
    if keys:
        log.info("flagging %d touched partitions (%d workers)", len(keys), jobs)
        store.pmap(partial(compact, cfg), keys, jobs, log, "partition")
    shutil.rmtree(staging, ignore_errors=True)

    allkeys = [(t, y) for t in store.tiles(det) + (["_rejected"] if (det / "_rejected").exists() else [])
               for y in store.years(det, t)]
    parts = store.pmap(partial(summarize, cfg), allkeys, jobs)
    summary = pd.concat(parts).groupby(["sensor", "platform"], dropna=False).sum().reset_index()
    summary.to_csv(out / "qc_summary.csv", index=False)
    log.info("QC summary (%d tiles, %d partitions):\n%s", len(store.tiles(det)), len(allkeys), summary.to_string(index=False))


if __name__ == "__main__":
    main()
