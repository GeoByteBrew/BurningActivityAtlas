# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""VIIRS-equivalent harmonization (hierarchical ratio factors), built to run tile by tile.

Method (after the Pix'Elles prototype, extended — see docs/01 §6 and docs/06):
  * Reference = one VIIRS platform (S-NPP). A *predictor* is a set of platforms that can stand in
    for it: the other VIIRS platforms (NOAA-20, NOAA-21) and the MODIS configurations (Terra+Aqua,
    Terra only, Aqua only). Factor f = Σ reference / Σ predictor on days when both work.
  * Strata: one factor per predictor and, optionally, per day/night half (`dn`).
  * Hierarchical shrinkage: all → super-region → region → cell → cell-month. A level with m
    predictor detections gets weight m / (m + K) on its own ratio, the rest from its parent.
  * Each predictor is calibrated on its own window (MODIS: stable-orbit years only).
  * Harmonized series: the reference when it works, else the first available predictor × f.
    Sensors are never summed.

Scaling: everything the fit needs is a table of sums per cell × month × stratum (`to_cm`). The
upper levels are fitted once from region × month sums of the whole domain; the cell levels are
fitted per processing tile with those upper levels as parents (`fit_factors(..., upper=)`).
Validation is accumulated as moment sums per tile and finished globally (`eval_parts/finish`).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_PREDICTORS = [
    {"name": "terra+aqua", "platforms": ["Terra", "Aqua"], "sensor": "MODIS"},
    {"name": "terra", "platforms": ["Terra"], "sensor": "MODIS"},
    {"name": "aqua", "platforms": ["Aqua"], "sensor": "MODIS"},
]
SUMS = ["m", "v", "m_frp", "v_frp"]
STRATA = ["config", "dn"]
LEVELS = [  # (name, keys, parent level)
    ("all", STRATA, None),
    ("super", STRATA + ["super"], "all"),
    ("region", STRATA + ["super", "region"], "super"),
    ("cell", STRATA + ["super", "region", "cell_id"], "region"),
    ("cell_month", STRATA + ["super", "region", "cell_id", "month"], "cell"),
]
LEVEL_NAMES = [n for n, *_ in LEVELS]
UPPER = LEVEL_NAMES[:3]
CM_KEYS = STRATA + ["super", "region", "cell_id", "year", "month"]
NO_REGION = "Unassigned"


def predictors(hc: dict | None = None) -> list[dict]:
    """Predictors in priority order (config `harmonization.predictors`, default: MODIS only)."""
    preds = (hc or {}).get("predictors") or DEFAULT_PREDICTORS
    return [{"sensor": "MODIS", **p} for p in preds]


def _prep(t: pd.DataFrame) -> pd.DataFrame:
    """Make the optional hierarchy columns explicit: dn ('all' = not split), super, region."""
    add = {}
    if "dn" not in t:
        add["dn"] = "all"
    if "super" not in t:
        add["super"] = "all"
    t = t.assign(**add) if add else t
    for c in ("super", "region"):
        if c in t and t[c].isna().any():
            t = t.assign(**{c: t[c].astype(object).where(t[c].notna(), NO_REGION)})
    return t


# --------------------------------------------------------------------------- tables
def wide_daily(daily: pd.DataFrame, platforms: list[str], split_dn: bool = False) -> pd.DataFrame:
    """Long daily counts (cell_id, date, platform, n_det, frp_sum[, n_day, frp_day]) -> one row
    per cell-day (and per day/night half when split_dn) with n_<platform>, frp_<platform>."""
    d = daily[daily["platform"].isin(platforms)]
    if split_dn:
        day = d.assign(dn="D", n=d["n_day"], frp=d["frp_day"])
        night = d.assign(dn="N", n=d["n_det"] - d["n_day"], frp=(d["frp_sum"] - d["frp_day"]).clip(lower=0))
        long = pd.concat([day, night], ignore_index=True)
        long = long[long["n"] > 0]
    else:
        long = d.assign(dn="all", n=d["n_det"], frp=d["frp_sum"])
    long = long.assign(platform=long["platform"].astype(str))
    w = long.pivot_table(index=["cell_id", "date", "dn"], columns="platform", values=["n", "frp"],
                         aggfunc="sum", fill_value=0)
    w.columns = [f"{v}_{p}" for v, p in w.columns]
    for p in platforms:
        for q in ("n", "frp"):
            if f"{q}_{p}" not in w:
                w[f"{q}_{p}"] = 0.0
    w = w.reset_index()
    w["date"] = pd.to_datetime(w["date"])
    w["year"], w["month"] = w["date"].dt.year, w["date"].dt.month
    return w


def availability(platforms: list[str], start, end, operational: dict | None = None,
                 outages: pd.DataFrame | None = None, preds: list[dict] | None = None) -> pd.DataFrame:
    """Per day: is each platform operating? (operational period of the product, minus outages).

    `operational` = {platform: [first_day, last_day or None]}. `outages` (platform, start, end) =
    known outages plus those detected from global daily counts (`detect_outages`). Availability is
    never inferred from regional detections: a day without fires is not a day without data.
    Adds `config` (first available predictor, in priority order) and `config_modis` (first
    available MODIS predictor), 'none' when nothing works.
    """
    days = pd.date_range(start, end, freq="D")
    av = pd.DataFrame(index=days)
    av.index.name = "date"
    operational = operational or {}
    for p in platforms:
        rng = list(operational.get(p) or [])
        a = rng[0] if len(rng) > 0 else None
        b = rng[1] if len(rng) > 1 else None
        ok = np.ones(len(days), dtype=bool)
        if a:
            ok &= av.index >= pd.Timestamp(a)
        if b:
            ok &= av.index <= pd.Timestamp(b)
        av[f"ok_{p}"] = ok
    if outages is not None and len(outages):
        for o in outages.itertuples():
            col = f"ok_{o.platform}"
            if col in av:
                av.loc[pd.Timestamp(o.start):pd.Timestamp(o.end), col] = False

    def first(ps):
        ps = [p for p in ps if all(f"ok_{s}" in av for s in p["platforms"])]
        if not ps:
            return np.full(len(av), "none", dtype=object)
        return np.select([av[[f"ok_{s}" for s in p["platforms"]]].all(axis=1) for p in ps],
                         [p["name"] for p in ps], default="none")

    preds = predictors() if preds is None else preds
    av["config"] = first(preds)
    av["config_modis"] = first([p for p in preds if p.get("sensor", "MODIS") == "MODIS"])
    return av


def detect_outages(counts: pd.DataFrame, operational: dict | None = None, window: int = 61,
                   frac: float = 0.1, min_level: float = 200.0) -> pd.DataFrame:
    """Outage days from *domain-wide* daily detections per platform (columns date, platform, n).

    A day is an outage when the platform's count falls below `frac` × its usual level, the usual
    level being the centred rolling median (or, inside long gaps, a third of the same-season
    median of other years). Platforms whose usual level is under `min_level` detections/day are
    left alone: there a quiet day is just a quiet day, which is why this only runs on global
    (or continental) data. Returns intervals: platform, start, end, days, source='detected'.
    """
    out = []
    counts = counts.assign(date=pd.to_datetime(counts["date"]))
    for p, g in counts.groupby("platform"):
        s = g.groupby("date")["n"].sum()
        a, b = s.index.min(), s.index.max()
        rng = list((operational or {}).get(p) or [])
        if rng and rng[0]:
            a = max(a, pd.Timestamp(rng[0])) if pd.Timestamp(rng[0]) > a else a
        s = s.reindex(pd.date_range(a, b, freq="D"), fill_value=0).astype(float)
        roll = s.rolling(window, center=True, min_periods=max(5, window // 4)).median()
        smooth = s.rolling(31, center=True, min_periods=5).median()
        clim = smooth.groupby(smooth.index.dayofyear).transform("median")
        usual = np.maximum(roll.fillna(0), clim.fillna(0) / 3.0)
        bad = (usual >= min_level) & (s < frac * usual)
        run = (bad != bad.shift()).cumsum()
        for _, r in s[bad].groupby(run[bad]):
            out.append({"platform": p, "start": r.index[0].date().isoformat(), "end": r.index[-1].date().isoformat(),
                        "days": len(r), "source": "detected"})
    return pd.DataFrame(out, columns=["platform", "start", "end", "days", "source"])


def calibration_rows(w: pd.DataFrame, av: pd.DataFrame, ref: str, preds: list[dict] | None = None) -> pd.DataFrame:
    """Cell-day predictor (m) and reference (v) sums on days when the platforms involved all work."""
    out = []
    w = _prep(w)
    for p in (predictors() if preds is None else preds):
        c, sats = p["name"], p["platforms"]
        if f"ok_{ref}" not in av or any(f"ok_{s}" not in av or f"n_{s}" not in w for s in sats):
            continue
        ok = av[f"ok_{ref}"] & av[[f"ok_{s}" for s in sats]].all(axis=1)
        t = w[w["date"].isin(av.index[ok])]
        if t.empty:
            continue
        out.append(pd.DataFrame({
            "config": c, "dn": t["dn"], "super": t["super"], "region": t["region"], "cell_id": t["cell_id"],
            "date": t["date"], "year": t["year"], "month": t["month"],
            "m": sum(t[f"n_{s}"] for s in sats), "v": t[f"n_{ref}"],
            "m_frp": sum(t[f"frp_{s}"] for s in sats), "v_frp": t[f"frp_{ref}"],
        }))
    cols = ["config", "dn", "super", "region", "cell_id", "date", "year", "month", *SUMS]
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=cols)


def to_cm(rows: pd.DataFrame) -> pd.DataFrame:
    """Sufficient statistics of the fit: sums per stratum × cell × year × month."""
    if rows.empty:
        return pd.DataFrame(columns=CM_KEYS + SUMS)
    return _prep(rows).groupby(CM_KEYS, as_index=False, observed=True)[SUMS].sum()


def collapse_dn(cm: pd.DataFrame) -> pd.DataFrame:
    """Day + night pooled (dn = 'all'): the same data as a single-factor model sees it."""
    keys = [c for c in cm.columns if c not in SUMS and c != "dn"]
    return cm.groupby(keys, as_index=False, observed=True)[SUMS].sum().assign(dn="all")


def in_window(t: pd.DataFrame, start=None, end=None) -> pd.Series:
    """Rows whose (year, month) lies in [start, end] (month resolution)."""
    k = t["year"].astype(int) * 12 + t["month"].astype(int) - 1
    ok = pd.Series(True, index=t.index)
    if start is not None:
        s = pd.Timestamp(start)
        ok &= k >= s.year * 12 + s.month - 1
    if end is not None:
        e = pd.Timestamp(end)
        ok &= k <= e.year * 12 + e.month - 1
    return ok


# --------------------------------------------------------------------------- factors
def _se_top(f, m, extra=0.0):
    # log-scale standard error of a ratio of two counts, for dispersion φ = 1 (see `interval`)
    return np.sqrt((1.0 + 1.0 / f.clip(lower=1e-9)) / m.clip(lower=1e-9) + extra)


def _shrink(d: pd.DataFrame, K: float) -> pd.DataFrame:
    w = d["m"] / (d["m"] + K)
    own_n = (d["v"] / d["m"].where(d["m"] > 0)).fillna(d["p_n"])
    ok = (d["m_frp"] > 0) & (d["v_frp"] > 0)
    own_frp = (d["v_frp"] / d["m_frp"].where(ok)).fillna(d["p_frp"])
    d["f_n"] = w * own_n + (1 - w) * d["p_n"]
    d["f_frp"] = w * own_frp + (1 - w) * d["p_frp"]
    # the prior is worth K predictor detections, hence (m + K); the parent's own error passes
    # through with the weight the parent keeps
    d["f_se"] = np.sqrt((1.0 + 1.0 / d["f_n"].clip(lower=1e-9)) / (d["m"] + K) + ((1 - w) * d["p_se"]) ** 2)
    return d.drop(columns=["p_n", "p_frp", "p_se"])


def fit_factors(rows: pd.DataFrame, K: float, upper: dict[str, pd.DataFrame] | None = None,
                max_level: dict[str, str] | None = None, levels: list[str] | None = None) -> dict[str, pd.DataFrame]:
    """Hierarchical factors from daily rows or cell-month sums.

    upper: already fitted levels (e.g. all/super/region from the whole domain); only the missing,
    deeper levels are fitted from `rows`. max_level: {config: deepest level it may use}, e.g.
    VIIRS-to-VIIRS factors stop at 'region' because their cell ratios are sampling noise.
    levels: fit only these levels (e.g. UPPER, from region × month sums that have no cell column).
    """
    rows = _prep(rows)
    F: dict[str, pd.DataFrame] = dict(upper or {})
    for name, keys, parent in LEVELS:
        if name in F or (levels is not None and name not in levels):
            continue
        d = rows.groupby(keys, as_index=False, observed=True)[SUMS].sum()
        if parent is None:
            d = d[(d["m"] > 0) & (d["v"] > 0)].copy()
            d["f_n"] = d["v"] / d["m"]
            d["f_frp"] = (d["v_frp"] / d["m_frp"].where(d["m_frp"] > 0)).fillna(d["f_n"])
            d["f_se"] = _se_top(d["f_n"], d["m"])
        else:
            pk = LEVELS[LEVEL_NAMES.index(parent)][1]
            p = F[parent][pk + ["f_n", "f_frp", "f_se"]].rename(columns={"f_n": "p_n", "f_frp": "p_frp", "f_se": "p_se"})
            d = _shrink(d.merge(p, on=pk, how="inner"), K)
        if max_level:
            lim = d["config"].map(lambda c: LEVEL_NAMES.index(max_level.get(c, LEVEL_NAMES[-1])))
            d = d[lim >= LEVEL_NAMES.index(name)]
        F[name] = d.reset_index(drop=True)
    return F


def attach_factors(t: pd.DataFrame, F: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Most specific available factor per row (needs config, region, cell_id, month)."""
    t = _prep(t).copy()
    t["f_n"], t["f_frp"], t["f_se"], t["factor_level"] = np.nan, np.nan, np.nan, None
    for name, keys, _ in reversed(LEVELS):
        if name not in F or F[name].empty:
            continue
        f = F[name][keys + ["f_n", "f_frp", "f_se"]].rename(columns={"f_n": "_fn", "f_frp": "_ff", "f_se": "_fs"})
        t = t.merge(f, on=keys, how="left")
        fill = t["f_n"].isna() & t["_fn"].notna()
        t.loc[fill, "factor_level"] = name
        t.loc[fill, "f_frp"] = t.loc[fill, "_ff"]
        t.loc[fill, "f_se"] = t.loc[fill, "_fs"]
        t["f_n"] = t["f_n"].fillna(t["_fn"])
        t = t.drop(columns=["_fn", "_ff", "_fs"])
    return t


def interval(f, se, phi: float = 1.0, z: float = 1.645) -> tuple:
    """Approximate interval of a factor: f · exp(± z · sqrt(φ) · se), 90 % by default.

    `se` is the log-scale error for Poisson counts; φ is the dispersion measured on held-out
    cell-months (`eval_finish` → phi), which carries the clustering of fire pixels and the fires
    the predictor does not see at all. An approximation, not a posterior: use it to rank how far
    a local factor can be trusted, not as a calibrated probability.
    """
    h = z * np.sqrt(phi) * np.asarray(se, float)
    f = np.asarray(f, float)
    return f * np.exp(-h), f * np.exp(h)


def bootstrap_factors(rows: pd.DataFrame, keys: list[str], n_boot: int, seed: int = 0) -> pd.DataFrame:
    """Percentile CI of Σv/Σm, resampling calendar months (block bootstrap) within each group."""
    rng = np.random.default_rng(seed)
    rows = rows.assign(ym=rows["year"].astype(int) * 100 + rows["month"].astype(int))
    blk = rows.groupby(keys + ["ym"], as_index=False, observed=True)[["m", "v"]].sum()
    out = []
    for k, g in blk.groupby(keys, observed=True):
        m, v = g["m"].to_numpy(float), g["v"].to_numpy(float)
        if m.sum() == 0:
            continue
        idx = rng.integers(0, len(g), size=(n_boot, len(g)))
        r = v[idx].sum(1) / np.maximum(m[idx].sum(1), 1e-9)
        k = k if isinstance(k, tuple) else (k,)
        out.append({**dict(zip(keys, k)), "f_n": v.sum() / m.sum(),
                    "ci05": np.percentile(r, 5), "ci95": np.percentile(r, 95), "n_months": len(g),
                    "m_total": int(m.sum()), "v_total": int(v.sum())})
    return pd.DataFrame(out)


# --------------------------------------------------------------------------- evaluation
EVAL_KEYS = ["config", "super", "region", "year"]
_MOM = ["n", "modis", "viirs", "harm", "abs_raw", "abs_harm", "hv", "hh", "vv", "miss", "chi_num", "chi_den"]


def eval_cells(cm: pd.DataFrame, F: dict) -> pd.DataFrame:
    """Predictor → reference-equivalent vs the true reference, per cell-month (day + night summed)."""
    s = attach_factors(cm, F)
    s["harm"] = s["m"] * s["f_n"]
    s = s[s["harm"].notna()]
    return s.groupby(["config", "super", "region", "cell_id", "year", "month"], as_index=False, observed=True)[["m", "v", "harm"]].sum()


def eval_parts(s: pd.DataFrame, sample: int = 20000, seed: int = 0):
    """Additive pieces of the validation of one tile: moment sums, region-month sums, rank sample."""
    f_eff = (s["harm"] / s["m"].where(s["m"] > 0)).fillna(0.0)
    s = s.assign(n=1, modis=s["m"], viirs=s["v"], abs_raw=(s["m"] - s["v"]).abs(), abs_harm=(s["harm"] - s["v"]).abs(),
                 hv=s["harm"] * s["v"], hh=s["harm"] ** 2, vv=s["v"] ** 2, miss=((s["m"] == 0) & (s["v"] > 0)).astype(int),
                 chi_num=(s["v"] - s["harm"]) ** 2, chi_den=s["harm"] * (1.0 + f_eff))
    mom = s.groupby(EVAL_KEYS, as_index=False, observed=True)[_MOM].sum()
    rm = s.groupby(EVAL_KEYS + ["month"], as_index=False, observed=True)[["harm", "v"]].sum()
    both = s.loc[(s["m"] > 0) & (s["v"] > 0), EVAL_KEYS + ["harm", "v"]]
    if len(both) > sample:
        both = both.sample(sample, random_state=seed)
    return mom, rm, both


def eval_finish(mom: pd.DataFrame, rm: pd.DataFrame, both: pd.DataFrame, by: list[str] | None = None) -> pd.DataFrame:
    """Validation table from accumulated pieces, grouped by config (+ `by` ⊆ super/region/year)."""
    keys = ["config"] + (by or [])
    g = mom.groupby(keys, observed=True)[_MOM].sum()
    out = pd.DataFrame({"cell_months": g["n"].astype(int), "modis": g["modis"], "viirs": g["viirs"], "harm": g["harm"],
                        "mae_raw": g["abs_raw"] / g["n"], "mae_harm": g["abs_harm"] / g["n"],
                        "raw_ratio": g["modis"] / g["viirs"], "harm_ratio": g["harm"] / g["viirs"]})
    cov = g["hv"] - g["harm"] * g["viirs"] / g["n"]
    var = (g["hh"] - g["harm"] ** 2 / g["n"]) * (g["vv"] - g["viirs"] ** 2 / g["n"])
    out["pearson"] = (cov / np.sqrt(var.where(var > 0))).where(g["n"] > 2)

    def corr(x, method="pearson"):
        if len(x) <= 2 or x["harm"].nunique() < 2 or x["v"].nunique() < 2:
            return np.nan                       # undefined on a constant series (tiny groups)
        return x["harm"].corr(x["v"], method=method)

    # Rows exist only where at least one sensor detected something; rank correlation over that
    # selection is biased towards 0 (the predictor is 0 in most small-fire cell-months). Spearman
    # is therefore computed where both saw fire (on a per-tile sample when the domain is large).
    out["spearman_both"] = both.groupby(keys, observed=True).apply(lambda x: corr(x, "spearman"), include_groups=False) if len(both) else np.nan
    out["modis_miss"] = g["miss"] / g["n"]
    rest = [c for c in ("region", "year", "month") if c not in keys]
    r = rm.groupby(keys + rest, as_index=False, observed=True)[["harm", "v"]].sum()
    out["r_region_month"] = r.groupby(keys, observed=True).apply(corr, include_groups=False)
    out["phi"] = (g["chi_num"] / g["chi_den"].where(g["chi_den"] > 0)).clip(lower=1.0)
    return out.reset_index()


def evaluate(rows_test: pd.DataFrame, F: dict, by: list[str] | None = None) -> pd.DataFrame:
    """One-shot validation (single table in memory): cell-month comparison on held-out data."""
    return eval_finish(*eval_parts(eval_cells(to_cm(rows_test) if "date" in rows_test else rows_test, F)), by=by)


# --------------------------------------------------------------------------- series
def harmonize_daily(w: pd.DataFrame, av: pd.DataFrame, F: dict, ref: str, factor_cell_col: str = "cell_id",
                    preds: list[dict] | None = None) -> pd.DataFrame:
    """One row per cell-day: the reference when it works, else first available predictor × factor.

    Also returns the MODIS → VIIRS-equivalent counterfactual on every day (`modis_as_viirs_*`,
    used to test the conversion against real VIIRS) and the raw MODIS total (`modis_raw_n`).
    """
    preds = predictors() if preds is None else preds
    modis_pl = sorted({s for p in preds if p.get("sensor", "MODIS") == "MODIS" for s in p["platforms"] if f"n_{s}" in w})
    t = _prep(w).merge(av[["config", "config_modis", f"ok_{ref}"]], left_on="date", right_index=True, how="left")
    t = t.reset_index(drop=True)
    t[["config", "config_modis"]] = t[["config", "config_modis"]].fillna("none")

    def convert(col):
        usable = [p for p in preds if all(f"n_{s}" in t for s in p["platforms"])]
        n = np.select([t[col] == p["name"] for p in usable], [sum(t[f"n_{s}"] for s in p["platforms"]) for p in usable], 0.0)
        frp = np.select([t[col] == p["name"] for p in usable], [sum(t[f"frp_{s}"] for s in p["platforms"]) for p in usable], 0.0)
        look = pd.DataFrame({"config": t[col], "dn": t["dn"], "super": t["super"], "region": t["region"],
                             "cell_id": t[factor_cell_col], "month": t["month"]})
        a = attach_factors(look, F)
        return n, frp, a["f_n"].to_numpy(), a["f_frp"].to_numpy(), a["f_se"].to_numpy(), a["factor_level"].to_numpy()

    n, frp, fn, ff, fs, lev = convert("config")
    same = (t["config"] == t["config_modis"]).all()
    mn, mfrp, mfn, mff, _, _ = (n, frp, fn, ff, fs, lev) if same else convert("config_modis")
    t["pred_n"], t["f_n"], t["f_se"], t["factor_level"] = n, fn, fs, lev
    t["modis_n"], t["modis_frp"] = mn, mfrp
    t["modis_raw_n"] = sum(t[f"n_{s}"] for s in modis_pl) if modis_pl else 0.0
    t["modis_as_viirs_n"], t["modis_as_viirs_frp"] = mn * mfn, mfrp * mff
    sensor = {p["name"]: p.get("sensor", "MODIS") for p in preds}
    viirs_ok = t[f"ok_{ref}"].fillna(False).astype(bool)
    pred_ok = t["config"].isin(list(sensor)) & ~np.isnan(fn)
    kind = t["config"].map(sensor).map({"MODIS": "modis_harmonized", "VIIRS": "viirs_backup"})
    t["source"] = np.where(viirs_ok, "viirs", np.where(pred_ok, kind, "missing"))
    t["harm_n"] = np.where(viirs_ok, t[f"n_{ref}"], np.where(pred_ok, n * fn, np.nan))
    t["harm_frp"] = np.where(viirs_ok, t[f"frp_{ref}"], np.where(pred_ok, frp * ff, np.nan))
    if (t["dn"] == "all").all():
        return t

    # day + night halves back to one row per cell-day; factor = detection-weighted mean
    wt = t["pred_n"] + 1e-9
    t["_wf"], t["_ws"], t["_w"] = t["f_n"] * wt, t["f_se"] * wt, wt.where(t["f_n"].notna(), 0.0)
    const = [c for c in ("cell_id", "date", "year", "month", "super", "region", "region_cell", "config", "config_modis",
                         f"ok_{ref}", "source", factor_cell_col) if c in t]
    const = list(dict.fromkeys(const))
    sums = [f"n_{ref}", f"frp_{ref}", "pred_n", "modis_n", "modis_frp", "modis_raw_n", "modis_as_viirs_n",
            "modis_as_viirs_frp", "harm_n", "harm_frp", "_wf", "_ws", "_w"]
    sums += [c for c in t if c.startswith(("n_", "frp_")) and c not in sums]
    g = t.groupby(const, as_index=False, observed=True, dropna=False)
    o = g[sums].sum()
    o["factor_level"] = g["factor_level"].first()["factor_level"].to_numpy()
    o["f_n"], o["f_se"] = o["_wf"] / o["_w"].where(o["_w"] > 0), o["_ws"] / o["_w"].where(o["_w"] > 0)
    o.loc[o["source"] == "missing", ["harm_n", "harm_frp"]] = np.nan
    return o.drop(columns=["_wf", "_ws", "_w"])


def median_with_zeros(monthly: pd.DataFrame, unit: str, value: str, years: list[int]) -> pd.DataFrame:
    """Median per (unit, calendar month) over `years`, counting absent unit-years as 0."""
    base = monthly[monthly["year"].isin(years)]
    units = base[unit].unique()
    full = pd.MultiIndex.from_product([units, years, range(1, 13)], names=[unit, "year", "month"])
    s = base.groupby([unit, "year", "month"], observed=True)[value].sum().reindex(full, fill_value=0)
    med = s.groupby([unit, "month"]).median().rename(f"median_{value}")
    q90 = s.groupby([unit, "month"]).quantile(0.9).rename(f"p90_{value}")
    return pd.concat([med, q90], axis=1).reset_index()
