# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Overpass identification, cross-sensor overpass matching and daily aggregation."""
from __future__ import annotations

import numpy as np
import pandas as pd


def assign_overpasses(df: pd.DataFrame, gap_min: float, prefix: str = "") -> pd.DataFrame:
    """Group each platform's detections into overpasses (time gap > gap_min starts a new one).

    Limitation: an overpass with zero detections in the AOI is invisible in FIRMS data;
    true overpass schedules need orbit/geolocation data (Sprint 3).
    Time gaps only separate overpasses over a limited area: call this per processing tile
    (globally a platform is always detecting something somewhere) and pass `prefix`.
    """
    df = df.sort_values(["platform", "acq_datetime"]).copy()
    gap = df.groupby("platform")["acq_datetime"].diff() > pd.Timedelta(minutes=gap_min)
    new = gap | df["platform"].ne(df["platform"].shift())
    seq = new.cumsum()
    first_t = df.groupby(seq)["acq_datetime"].transform("min")
    df["overpass_id"] = prefix + df["platform"].astype(str) + "_" + first_t.dt.strftime("%Y%m%dT%H%M")
    return df


def overpass_table(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby(["overpass_id", "platform", "sensor"])
    t = g["acq_datetime"].agg(t_start="min", t_end="max", n_det="size").reset_index()
    t["t_mid"] = t["t_start"] + (t["t_end"] - t["t_start"]) / 2
    t["daynight"] = g["daynight"].agg(lambda s: s.mode().iat[0] if len(s.mode()) else pd.NA).values
    return t


def match_overpasses(ov: pd.DataFrame, plat_a: str, plat_b: str, tol_min: float) -> pd.DataFrame:
    """Nearest-in-time overpass of `plat_b` for each overpass of `plat_a` within ±tol_min."""
    a = ov[ov["platform"] == plat_a].sort_values("t_mid")
    b = ov[ov["platform"] == plat_b].sort_values("t_mid")
    if a.empty or b.empty:
        return pd.DataFrame(columns=["overpass_a", "overpass_b", "dt_min"])
    m = pd.merge_asof(
        a[["overpass_id", "t_mid"]].rename(columns={"overpass_id": "overpass_a"}),
        b[["overpass_id", "t_mid"]].rename(columns={"overpass_id": "overpass_b", "t_mid": "t_mid_b"}),
        left_on="t_mid", right_on="t_mid_b", direction="nearest",
        tolerance=pd.Timedelta(minutes=tol_min),
    ).dropna(subset=["overpass_b"])
    m["dt_min"] = (m["t_mid_b"] - m["t_mid"]).dt.total_seconds() / 60
    return m[["overpass_a", "overpass_b", "dt_min"]].reset_index(drop=True)


def matched_cell_counts(df: pd.DataFrame, pairs: pd.DataFrame, cell_col: str) -> pd.DataFrame:
    """Cell-level detection counts for each matched overpass pair (outer join; 0 = not detected).

    Cells where neither sensor detected anything are absent — FIRMS has no non-detection records.
    """
    if pairs.empty:
        return pd.DataFrame(columns=["overpass_a", "overpass_b", cell_col, "n_a", "n_b"])
    cnt = df.groupby(["overpass_id", cell_col]).size().rename("n").reset_index()
    a = pairs.merge(cnt, left_on="overpass_a", right_on="overpass_id").drop(columns="overpass_id")
    b = pairs.merge(cnt, left_on="overpass_b", right_on="overpass_id").drop(columns="overpass_id")
    keys = ["overpass_a", "overpass_b", "dt_min", cell_col]
    out = a.merge(b, on=keys, how="outer", suffixes=("_a", "_b"))
    out[["n_a", "n_b"]] = out[["n_a", "n_b"]].fillna(0).astype(int)
    return out


def daily_counts(df: pd.DataFrame, cell_col: str, qc_col: str) -> pd.DataFrame:
    """Per cell, UTC day and platform: detection count, FRP sums, number of overpasses.

    n_day / frp_day hold the daytime part (n_night = n_det − n_day, night FRP = frp_sum − frp_day),
    which is what the day/night factors are fitted on.
    """
    d = df[df[qc_col]]
    is_day = (d["daynight"] == "D").to_numpy()
    d = d.assign(_day=is_day.astype("int32"), _frp_day=np.where(is_day, d["frp"].fillna(0.0), 0.0))
    g = d.groupby([cell_col, "acq_date_utc", "sensor", "platform"], observed=True)
    out = g.agg(
        n_det=("det_id", "size"),
        n_overpass=("overpass_id", "nunique"),
        frp_sum=("frp", "sum"),
        frp_max=("frp", "max"),
        scan_mean=("scan", "mean"),
        n_day=("_day", "sum"),
        frp_day=("_frp_day", "sum"),
    ).reset_index()
    out = out.rename(columns={cell_col: "cell_id", "acq_date_utc": "date"})
    out["n_night"] = out["n_det"] - out["n_day"]
    return out
