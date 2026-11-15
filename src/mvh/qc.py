# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Standardization and quality control of FIRMS MODIS / VIIRS detections.

Nothing is deleted here: every row gets QC flags, and `clean` subsets are derived from them.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import record_start

STD_COLUMNS = [
    "det_id", "sensor", "platform", "product", "source", "latitude", "longitude",
    "acq_datetime", "acq_date_utc", "daynight", "scan", "track", "pixel_area_km2",
    "bt_fire", "bt_bg", "frp", "conf_raw", "conf_num", "conf_class", "type", "version",
]

MODIS_PLATFORM = {"T": "Terra", "TERRA": "Terra", "A": "Aqua", "AQUA": "Aqua"}
VIIRS_PLATFORM = {"N": "S-NPP", "NPP": "S-NPP", "SNPP": "S-NPP", "SUOMI NPP": "S-NPP",
                  "N20": "NOAA-20", "1": "NOAA-20", "J1": "NOAA-20", "NOAA-20": "NOAA-20",
                  "N21": "NOAA-21", "2": "NOAA-21", "J2": "NOAA-21", "NOAA-21": "NOAA-21"}


def iter_raw(file: Path, chunksize: int = 1_000_000):
    """Yield a raw FIRMS CSV in chunks (global archive files hold tens of millions of rows)."""
    if Path(file).stat().st_size == 0:
        return
    for df in pd.read_csv(file, dtype={"acq_time": str, "satellite": str, "confidence": str, "version": str},
                          chunksize=chunksize):
        if len(df):
            yield df


def parse_datetime(acq_date: pd.Series, acq_time: pd.Series) -> pd.Series:
    t = acq_time.astype(str).str.replace(":", "", regex=False).str.split(".").str[0].str.zfill(4)
    return pd.to_datetime(acq_date.astype(str) + " " + t, format="%Y-%m-%d %H%M", utc=True, errors="coerce")


def modis_conf_class(conf: pd.Series, classes: dict) -> pd.Series:
    out = pd.Series(pd.NA, index=conf.index, dtype="object")
    for label, (lo, hi) in classes.items():
        out[(conf >= lo) & (conf <= hi)] = label[0]  # l / n / h
    return out


def standardize(raw: pd.DataFrame, src: dict, qc_cfg: dict) -> pd.DataFrame:
    """Map a raw FIRMS CSV frame (one source) onto the common schema."""
    if raw.empty:
        return pd.DataFrame(columns=STD_COLUMNS)
    sensor = src["sensor"]
    df = pd.DataFrame(index=raw.index)
    df["sensor"] = sensor
    df["source"] = src["source"]
    df["product"] = src.get("product")
    df["latitude"] = pd.to_numeric(raw["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(raw["longitude"], errors="coerce")
    df["acq_datetime"] = parse_datetime(raw["acq_date"], raw["acq_time"])
    df["acq_date_utc"] = df["acq_datetime"].dt.tz_convert(None).dt.normalize()
    df["daynight"] = raw.get("daynight", pd.Series(pd.NA, index=raw.index)).astype("string").str.upper()
    df["scan"] = pd.to_numeric(raw.get("scan"), errors="coerce")
    df["track"] = pd.to_numeric(raw.get("track"), errors="coerce")
    df["pixel_area_km2"] = df["scan"] * df["track"]
    df["frp"] = pd.to_numeric(raw.get("frp"), errors="coerce")
    df["type"] = pd.to_numeric(raw["type"], errors="coerce") if "type" in raw else np.nan
    df["version"] = raw.get("version", pd.Series(pd.NA, index=raw.index)).astype("string")
    conf = raw["confidence"].astype("string").str.strip()
    df["conf_raw"] = conf

    if sensor == "MODIS":
        sat = raw["satellite"].astype("string").str.strip().str.upper()
        df["platform"] = sat.map(MODIS_PLATFORM)
        df["bt_fire"] = pd.to_numeric(raw.get("brightness"), errors="coerce")
        df["bt_bg"] = pd.to_numeric(raw.get("bright_t31"), errors="coerce")
        df["conf_num"] = pd.to_numeric(conf, errors="coerce")
        df["conf_class"] = modis_conf_class(df["conf_num"], qc_cfg["modis_conf_classes"])
    else:
        if src.get("platform"):
            df["platform"] = src["platform"]
        else:
            df["platform"] = raw["satellite"].astype("string").str.strip().str.upper().map(VIIRS_PLATFORM)
        df["bt_fire"] = pd.to_numeric(raw.get("bright_ti4"), errors="coerce")
        df["bt_bg"] = pd.to_numeric(raw.get("bright_ti5"), errors="coerce")
        df["conf_num"] = np.nan
        df["conf_class"] = conf.str.lower().str[0]  # low/nominal/high or l/n/h -> l/n/h
    df["det_id"] = (
        df["source"].astype(str) + "_" + df["acq_datetime"].dt.strftime("%Y%m%d%H%M") + "_"
        + df["latitude"].round(5).astype(str) + "_" + df["longitude"].round(5).astype(str)
    )
    return df[STD_COLUMNS]


def _in_bbox(df: pd.DataFrame, cfg: dict) -> pd.Series:
    """Global run: the domain is the bbox of the configuration (it leaves out Antarctica and the
    polar caps, where a 'fire' detection is a station, a volcano or an artefact)."""
    w, s, e, n = cfg["aoi"]["bbox_wgs84"]
    return df["longitude"].between(w, e) & df["latitude"].between(s, n)


def add_qc_flags(df: pd.DataFrame, cfg: dict, aoi_contains=None, aoi_region=None, clip: bool = True,
                 inplace: bool = False) -> pd.DataFrame:
    """Add boolean QC flags and per-scenario membership columns (q_Q1, q_Q2, ...).

    aoi_region: optional fn(lon, lat) -> region name or None; sets `region`.
    clip: True (regional run) keeps only detections inside a region; False (global run) keeps
    everything inside aoi.bbox_wgs84 and leaves `region` empty for the few points no polygon claims.
    inplace: add the columns to `df` itself; a busy world partition holds millions of rows and a
    copy doubles its memory.
    """
    qc = cfg["qc"]
    start = pd.Timestamp(record_start(cfg), tz="UTC")
    end = pd.Timestamp(cfg["period"]["end"], tz="UTC") + pd.Timedelta(days=1)

    if not inplace:
        df = df.copy()
    df["f_coord_ok"] = df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)
    grid_cols = [c for c in df.columns if c.startswith("cell_")]
    df["f_grid_ok"] = (df[grid_cols] >= 0).all(axis=1) if grid_cols else True
    df["f_time_ok"] = df["acq_datetime"].notna() & (df["acq_datetime"] >= start) & (df["acq_datetime"] < end)
    df["f_platform_ok"] = df["platform"].notna()
    # NRT products have no `type`; unknown is kept but visible through f_type_known
    df["f_type_known"] = df["type"].notna()
    df["f_type_ok"] = df["type"].isna() | df["type"].isin(qc["keep_types"])
    df["f_duplicate"] = df.duplicated(subset=["det_id"], keep="first")
    lon, lat = df["longitude"].to_numpy(), df["latitude"].to_numpy()
    if aoi_region is not None:
        df["region"] = aoi_region(lon, lat)
        df["f_in_aoi"] = df["region"].notna() if clip else _in_bbox(df, cfg)
    elif aoi_contains is not None:
        df["region"] = None
        df["f_in_aoi"] = aoi_contains(lon, lat)
    else:
        df["region"] = None
        df["f_in_aoi"] = True

    base = (df["f_coord_ok"] & df["f_grid_ok"] & df["f_time_ok"] & df["f_platform_ok"] & df["f_type_ok"]
            & ~df["f_duplicate"] & df["f_in_aoi"])
    df["f_base_ok"] = base

    is_modis = df["sensor"] == "MODIS"
    for name, sc in qc["scenarios"].items():
        modis_ok = is_modis & (df["conf_num"] >= sc["modis_min_conf"])
        viirs_ok = ~is_modis & df["conf_class"].isin(sc["viirs_conf"])
        df[f"q_{name}"] = base & (modis_ok | viirs_ok)
    return df


def qc_summary(df: pd.DataFrame, scenarios: list[str]) -> pd.DataFrame:
    flags = ["f_coord_ok", "f_time_ok", "f_platform_ok", "f_type_ok", "f_in_aoi", "f_base_ok"]
    g = df.groupby(["sensor", "platform"], dropna=False)
    out = g.size().rename("n_raw").to_frame()
    out["n_duplicate"] = g["f_duplicate"].sum()
    for f in flags:
        out[f"n_{f}"] = g[f].sum()
    for s in scenarios:
        out[f"n_{s}"] = g[f"q_{s}"].sum()
    return out.reset_index()
