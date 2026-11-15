# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Synthetic FIRMS-like archive with known sensor ratios, for end-to-end tests.

Fire sites are scattered over south-west Europe and north-west Africa (3 UN sub-regions, 2 or more
processing tiles with a small tile size). Truth: VIIRS = 3 × (Terra + Aqua) by day and 6 × at night,
× 1.5 south of 36°N; NOAA-20 / NOAA-21 see the same fires as S-NPP. S-NPP is silent for
2022-07-26 .. 2022-08-10 (outage to be found by the screening).

    python tests/synth.py <work_dir>      writes <work_dir>/config.yaml and the raw CSV files
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
BBOX = [-10.0, 30.0, 8.0, 48.0]
DAY_F, NIGHT_F, SOUTH = 3.0, 6.0, 1.5
OUTAGE = ("2022-07-26", "2022-08-10")
STARTS = {"Terra": "2010-01-01", "Aqua": "2010-01-01", "S-NPP": "2012-01-20", "NOAA-20": "2018-04-01", "NOAA-21": "2023-03-01"}
END = "2025-12-31"


def _platform(rng, name, sites, days, season):
    lon, lat, lam = sites
    act = days >= np.datetime64(STARTS[name])
    if name == "S-NPP":
        act &= ~((days >= np.datetime64(OUTAGE[0])) & (days <= np.datetime64(OUTAGE[1])))
    modis = name in ("Terra", "Aqua")
    share = {"Terra": 0.4, "Aqua": 0.6}.get(name, 1.0)
    south = np.where(lat < 36.0, SOUTH, 1.0)
    out = []
    for dn, night_share, f in (("D", 0.7, DAY_F), ("N", 0.3, NIGHT_F)):
        mu = season[:, None] * lam[None, :] * night_share * share * (1.0 if modis else f * south[None, :])
        n = rng.poisson(mu * act[:, None])
        di, si = np.nonzero(n)
        rep = np.repeat(np.arange(len(di)), n[di, si])
        k = len(rep)
        d, s = di[rep], si[rep]
        jit = 0.004 if modis else 0.002
        hh = {"Terra": (10, 22), "Aqua": (13, 1), "S-NPP": (13, 1), "NOAA-20": (12, 0), "NOAA-21": (12, 0)}[name][dn == "N"]
        base = {"latitude": (lat[s] + rng.normal(0, jit, k)).round(5), "longitude": (lon[s] + rng.normal(0, jit, k)).round(5),
                "scan": 1.2 if modis else 0.4, "track": 1.1 if modis else 0.4,
                "acq_date": pd.DatetimeIndex(days[d]).strftime("%Y-%m-%d"),
                "acq_time": [f"{hh:02d}{m:02d}" for m in rng.integers(0, 12, k) + (s % 3) * 15],
                "frp": rng.gamma(2.0, 8.0 if modis else 2.5, k).round(2), "daynight": dn,
                "type": rng.choice([0, 2], k, p=[0.97, 0.03])}
        if modis:
            base.update(brightness=330.0, bright_t31=300.0, satellite=name, instrument="MODIS", version="6.1",
                        confidence=rng.integers(10, 101, k).astype(str))
        else:
            base.update(bright_ti4=335.0, bright_ti5=295.0, satellite={"S-NPP": "N", "NOAA-20": "N20", "NOAA-21": "N21"}[name],
                        instrument="VIIRS", version="2", confidence=rng.choice(["l", "n", "h"], k, p=[0.1, 0.8, 0.1]))
        out.append(pd.DataFrame(base))
    return pd.concat(out, ignore_index=True)


def make(work: Path, n_sites: int = 260, scale: float = 1.0, seed: int = 0) -> Path:
    """Write raw CSVs (one per source and year, archive style) and a config; return the config path."""
    rng = np.random.default_rng(seed)
    lon = rng.uniform(-8.5, 3.0, n_sites)
    lat = np.where(rng.random(n_sites) < 0.3, rng.uniform(31.0, 35.0, n_sites), rng.uniform(37.5, 47.0, n_sites))
    lon = np.where(lat < 36, rng.uniform(-8.0, -2.0, n_sites), lon)
    lam = rng.gamma(0.6, 0.25, n_sites) * scale
    days = pd.date_range("2010-01-01", END, freq="D").to_numpy()
    month = pd.DatetimeIndex(days).month.to_numpy()
    season = 0.25 + 1.75 * np.exp(-((month - 8) ** 2) / 6.0)
    year_fx = dict(zip(range(2010, 2026), rng.lognormal(0, 0.25, 16)))
    season = np.asarray(season) * np.array([year_fx[y] for y in pd.DatetimeIndex(days).year])
    raw = work / "raw" / "synth"
    src = {"Terra": "MODIS_SP", "Aqua": "MODIS_SP", "S-NPP": "VIIRS_SNPP_SP", "NOAA-20": "VIIRS_NOAA20_SP", "NOAA-21": "VIIRS_NOAA21_SP"}
    for name, sid in src.items():
        df = _platform(rng, name, (lon, lat, lam), days, season)
        (raw / sid).mkdir(parents=True, exist_ok=True)
        for y, g in df.groupby(df["acq_date"].str[:4]):
            g.to_csv(raw / sid / f"{name.lower()}_{y}_archive.csv", index=False)

    cfg = {
        "extends": str(ROOT / "config" / "config.yaml"),
        "project": {"region": "synth"},
        "aoi": {"name": "Synthetic SW Europe + NW Africa", "bbox_wgs84": BBOX, "file": str(work / "regions.gpkg"),
                "simplify_deg": 0.05},
        "period": {"start": "2012-01-20", "end": END, "modis_start": "2010-01-01"},
        "grid": {"tile_cells": 150},
        "run": {"jobs": 1, "chunk_rows": 200000},
        "availability": {"detect_outages": True, "min_daily_detections": 10, "outages_file": str(work / "outages.csv")},
        "harmonization": {"n_bootstrap": 100, "fine_scale": True},
        "firms": {"tile_deg": None},
        "paths": {k: str(work / k) for k in ("raw", "processed", "grids", "aggregated", "harmonized")}
                 | {"aoi": str(ROOT / "data" / "aoi"), "reports": str(work / "out" / "reports"),
                    "figures": str(work / "out" / "figures"), "csv": str(work / "out" / "csv")},
        "web": {"overview": {"id": "world", "name": "Synthetic world", "cell_m": 50000, "region_level": "super"},
                "details": [{"id": "iberia", "name": "Iberia", "bbox": [-10.0, 35.8, 5.0, 45.2]}]},
    }
    f = work / "config.yaml"
    f.write_text(yaml.safe_dump(cfg, sort_keys=False))
    return f


if __name__ == "__main__":
    print(make(Path(sys.argv[1]).resolve()))
