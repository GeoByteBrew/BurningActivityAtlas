"""VIIRS-equivalent harmonization, validation and Burning Activity Calendar — tile by tile.

Pass 1 (per tile)  daily counts → calibration sums per cell × month × predictor × day/night
Global step        availability calendar (known + detected outages), upper factor levels
                   (all → super-region → region), bootstrap intervals
Pass 2 (per tile)  cell and cell-month factors, held-out validation, harmonized daily series,
                   monthly cell table with climatology and anomaly
Finish             validation tables, drift diagnostics, report and figures

Inputs : data/aggregated/{daily_<scale>_<main QC>, cells, platform_days}/
Outputs: data/harmonized/   availability.csv, outages_used.csv, factors_{all,super,region}.csv,
                            factors/<tile>.parquet, calib_cm/<tile>.parquet,
                            daily_<scale>/<tile>/<year>.parquet, monthly_<scale>/<tile>.parquet,
                            monthly_region.parquet
         outputs/csv/harm_*.csv, outputs/reports/harmonization_report.md (+ figures)
"""
import _bootstrap  # noqa: F401

from functools import partial

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from mvh import harmonize as H
from mvh import store
from mvh.config import ROOT, cli, load_config, path, record_start, setup_logging
from mvh.grid import label, parent_ids
from mvh.report import md_table

log = setup_logging("06_harmonize")
COL = {"MODIS raw (Terra+Aqua)": "#D55E00", "VIIRS raw": "#0072B2",
       "Harmonized series": "#222222", "MODIS → VIIRS-equivalent": "#009E73"}
VARIANTS = {"split": lambda cm: cm, "pooled": H.collapse_dn}
REG_KEYS = H.STRATA + ["super", "region", "year", "month"]
MONTHLY = ["harm_n", "harm_frp", "viirs_n", "modis_raw_n", "modis_as_viirs_n"]


def setup(cfg):
    hc = cfg["harmonization"]
    ref, preds = hc["reference_platform"], H.predictors(hc)
    platforms = [ref] + sorted({s for p in preds for s in p["platforms"]})
    return hc, ref, preds, platforms


def with_regions(w: pd.DataFrame, cells: pd.DataFrame, col: str = "cell_id") -> pd.DataFrame:
    c = cells.set_index("cell_id")
    w["region"] = w[col].map(c["region"])
    w["super"] = w[col].map(c["super"])
    return w


def year_wide(cfg, platforms, tile, year, scale, cells):
    q = cfg["qc"]["main_scenario"]
    d = store.read(path(cfg, "aggregated") / f"daily_{label(scale)}_{q}", tile, year,
                   columns=["cell_id", "date", "platform", "n_det", "frp_sum", "n_day", "frp_day"])
    return d[d["platform"].isin(platforms)]


# --------------------------------------------------------------------------- pass 1
def pass1(cfg, av, tile):
    hc, ref, preds, platforms = setup(cfg)
    agg, out = path(cfg, "aggregated"), path(cfg, "harmonized")
    fs = hc["factor_scale_m"]
    q = cfg["qc"]["main_scenario"]
    cells = store.read(agg / "cells", tile)
    parts = []
    for y in store.years(agg / f"daily_{label(fs)}_{q}", tile):
        d = year_wide(cfg, platforms, tile, y, fs, cells)
        if d.empty:
            continue
        w = with_regions(H.wide_daily(d, platforms, split_dn=True), cells)
        parts.append(H.to_cm(H.calibration_rows(w, av, ref, preds)))
    parts = [p for p in parts if len(p)]
    cm = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=H.CM_KEYS + H.SUMS)
    cm[H.SUMS] = cm[H.SUMS].astype(float)
    cm.to_parquet(store.part(out / "calib_cm", tile), index=False)
    return cm.groupby(REG_KEYS, as_index=False, observed=True)[H.SUMS].sum()


# --------------------------------------------------------------------------- windows
def windows(cfg, preds, blocks) -> dict:
    """Per predictor: calibration window (month indices) and the chronological train/test cut."""
    out = {}
    cal_end = cfg["calibration"]["end"]
    k_all = blocks["year"].astype(int) * 12 + blocks["month"].astype(int) - 1
    for p in preds:
        a, b = p.get("calibration") or [None, cal_end]
        b = b or cal_end
        ok = (blocks["config"] == p["name"]) & H.in_window(blocks, a, b) & (blocks["m"] + blocks["v"] > 0)
        months = np.sort(k_all[ok].unique())
        if len(months) < 3:
            continue
        cut = int(months[min(len(months) - 1, int(len(months) * cfg["harmonization"]["train_fraction"]))])
        out[p["name"]] = (int(months[0]), int(months[-1]), cut)
    return out


def masks(t: pd.DataFrame, win: dict):
    """(calibration, train, test) boolean masks of a table with config, year, month."""
    k = (t["year"].astype(int) * 12 + t["month"].astype(int) - 1).to_numpy()
    cfgs = t["config"].astype(object)
    lo = cfgs.map(lambda c: win.get(c, (1, 0, 0))[0]).to_numpy()
    hi = cfgs.map(lambda c: win.get(c, (1, 0, 0))[1]).to_numpy()
    cut = cfgs.map(lambda c: win.get(c, (1, 0, 0))[2]).to_numpy()
    calib = (k >= lo) & (k <= hi)
    return calib, calib & (k < cut), calib & (k >= cut)


def ym(k: int) -> str:
    return f"{k // 12}-{k % 12 + 1:02d}"


# --------------------------------------------------------------------------- pass 2
def pass2(cfg, av, win, upper, max_level, tile):
    hc, ref, preds, platforms = setup(cfg)
    agg, out = path(cfg, "aggregated"), path(cfg, "harmonized")
    fs, fine, K = hc["factor_scale_m"], min(cfg["grid"]["sizes_m"]), hc["shrinkage_K"]
    q = cfg["qc"]["main_scenario"]
    mode = hc.get("daynight", "split")
    cells = store.read(agg / "cells", tile)
    cm = store.read(out / "calib_cm", tile)
    res = {"eval": [], "tile": tile}

    F = None
    for v, fn in VARIANTS.items():
        cmv = fn(cm) if len(cm) else cm.assign(dn="all")
        calib, train, test = masks(cmv, win)
        Ftr = H.fit_factors(cmv[train], K, upper=upper[v]["train"], max_level=max_level)
        Ffull = H.fit_factors(cmv[calib], K, upper=upper[v]["full"], max_level=max_level)
        for name, sub, FF in (("test", cmv[test], Ftr), ("years", cmv, Ffull)):
            if len(sub):
                mom, rm, both = H.eval_parts(H.eval_cells(sub, FF))
                res["eval"].append((name, v, mom, rm, both))
        if v == mode:
            F = Ffull
    lower = pd.concat([F[n].assign(level=n) for n in ("cell", "cell_month")], ignore_index=True)
    lower.to_parquet(store.part(out / "factors", tile), index=False)

    monthly, levels, tot = [], [], {"n5": 0.0, "n1": 0.0}
    keep = ["cell_id", "region", "super", "date", "year", "month", "source", "config", "factor_level", "f_n", "f_se",
            f"n_{ref}", "pred_n", "modis_n", "modis_raw_n", "modis_as_viirs_n", "harm_n", f"frp_{ref}", "modis_frp", "harm_frp"]
    for y in store.years(agg / f"daily_{label(fs)}_{q}", tile):
        d = year_wide(cfg, platforms, tile, y, fs, cells)
        if d.empty:
            continue
        w = with_regions(H.wide_daily(d, platforms, split_dn=mode == "split"), cells)
        h = H.harmonize_daily(w, av, F, ref, preds=preds)
        h[keep].to_parquet(store.part(out / f"daily_{label(fs)}", tile, y), index=False)
        h = h.assign(viirs_n=h[f"n_{ref}"])
        monthly.append(h.groupby(["cell_id", "year", "month"], as_index=False)[MONTHLY].sum())
        levels.append(h.groupby(["source", "factor_level"], dropna=False).size())
        tot["n5"] += float(h["harm_n"].sum())
        if hc.get("fine_scale", True) and fine != fs:
            d1 = year_wide(cfg, platforms, tile, y, fine, cells)
            w1 = H.wide_daily(d1, platforms, split_dn=mode == "split")
            w1["cell_parent"] = parent_ids(w1["cell_id"], fine, fs)
            w1 = with_regions(w1, cells, "cell_parent")     # 1 km cells take region and factor of their 5 km parent
            h1 = H.harmonize_daily(w1, av, F, ref, factor_cell_col="cell_parent", preds=preds)
            h1[keep + ["cell_parent"]].to_parquet(store.part(out / f"daily_{label(fine)}", tile, y), index=False)
            tot["n1"] += float(h1["harm_n"].sum())
    if not monthly:
        return res
    m5 = pd.concat(monthly, ignore_index=True)
    m5 = with_regions(m5, cells)
    base_years = list(range(hc["baseline_years"][0], hc["baseline_years"][1] + 1))
    m5 = m5.merge(H.median_with_zeros(m5, "cell_id", "harm_n", base_years), on=["cell_id", "month"], how="left")
    m5["anomaly_n"] = m5["harm_n"] - m5["median_harm_n"].fillna(0)
    m5.to_parquet(store.part(out / f"monthly_{label(fs)}", tile), index=False)
    res["region_month"] = H._prep(m5).groupby(["super", "region", "year", "month"], as_index=False)[MONTHLY].sum()
    res["levels"] = pd.concat(levels).groupby(level=[0, 1], dropna=False).sum()
    res["tot"] = tot
    return res


def collect(results, name, variant):
    parts = [e[2:] for r in results for e in r["eval"] if e[0] == name and e[1] == variant]
    if not parts:
        e = pd.DataFrame(columns=H.EVAL_KEYS + H._MOM)
        return e, pd.DataFrame(columns=H.EVAL_KEYS + ["month", "harm", "v"]), pd.DataFrame(columns=H.EVAL_KEYS + ["harm", "v"])
    return tuple(pd.concat([p[i] for p in parts], ignore_index=True) for i in range(3))


# --------------------------------------------------------------------------- main
def main():
    args = cli(__doc__).parse_args()
    cfg = load_config(args.config)
    hc, ref, preds, platforms = setup(cfg)
    jobs = args.jobs or cfg["run"].get("jobs", 1)
    q = cfg["qc"]["main_scenario"]
    agg, out = path(cfg, "aggregated"), path(cfg, "harmonized")
    rep, fig, csv = path(cfg, "reports"), path(cfg, "figures"), path(cfg, "csv")
    fs, fine, K = hc["factor_scale_m"], min(cfg["grid"]["sizes_m"]), hc["shrinkage_K"]
    mode = hc.get("daynight", "split")
    tiles = store.tiles(agg / f"daily_{label(fs)}_{q}")
    if not tiles:
        raise SystemExit("no daily counts — run 04_aggregate.py first")

    # ---- availability calendar: operational periods − known outages − detected outages
    ac = cfg.get("availability", {})
    frames = []
    of = ROOT / ac.get("outages_file", "data/ancillary/outages.csv")
    if of.exists() and of.stat().st_size > 0:
        frames.append(pd.read_csv(of).assign(source="known"))
    if ac.get("detect_outages"):
        counts = store.read_all(agg / "platform_days").groupby(["date", "platform"], as_index=False)["n"].sum()
        frames.append(H.detect_outages(counts, hc.get("operational"), ac.get("window_days", 61),
                                       ac.get("drop_fraction", 0.1), ac.get("min_daily_detections", 200)))
    outages = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["platform", "start", "end", "source"])
    outages = outages.dropna(subset=["platform", "start", "end"])
    outages.to_csv(out / "outages_used.csv", index=False)
    log.info("outages applied: %d (%s)", len(outages), outages.groupby("source").size().to_dict() if len(outages) else "none")
    av = H.availability(platforms, record_start(cfg), cfg["period"]["end"], hc.get("operational"), outages, preds)

    # ---- pass 1: calibration sums per tile, region × month blocks for the whole domain
    log.info("pass 1: calibration sums, %d tiles, %d workers", len(tiles), jobs)
    blocks = [b for b in store.pmap(partial(pass1, cfg, av), tiles, jobs, log) if len(b)]
    if not blocks:
        raise SystemExit("no day with both the reference and a predictor — nothing to calibrate")
    blocks = pd.concat(blocks, ignore_index=True)
    blocks = blocks.groupby(REG_KEYS, as_index=False, observed=True)[H.SUMS].sum()
    win = windows(cfg, preds, blocks)
    for c, (a, b, cut) in win.items():
        log.info("%-11s calibration %s .. %s, train < %s ≤ test", c, ym(a), ym(b), ym(cut))
    max_level = {p["name"]: p["max_level"] for p in preds if p.get("max_level")}
    upper = {}
    for v, fn in VARIANTS.items():
        b = fn(blocks)
        calib, train, _ = masks(b, win)
        upper[v] = {"train": H.fit_factors(b[train], K, max_level=max_level, levels=H.UPPER),
                    "full": H.fit_factors(b[calib], K, max_level=max_level, levels=H.UPPER)}
    usable = set(upper[mode]["full"]["all"]["config"])
    dropped = [p["name"] for p in preds if p["name"] not in usable]
    if dropped:
        log.warning("predictors without calibration data, not used: %s", dropped)
        preds = [p for p in preds if p["name"] in usable]
        cfg["harmonization"]["predictors"] = preds
        av = H.availability(platforms, record_start(cfg), cfg["period"]["end"], hc.get("operational"), outages, preds)
    av.to_csv(out / "availability.csv")
    for n in H.UPPER:
        upper[mode]["full"][n].to_csv(out / f"factors_{n}.csv", index=False)

    pooled = H.collapse_dn(blocks)
    pc = pooled[masks(pooled, win)[0]]
    bc = blocks[masks(blocks, win)[0]]
    nb = hc["n_bootstrap"]
    ci = H.bootstrap_factors(pc, ["config"], nb)
    ci_dn = H.bootstrap_factors(bc, ["config", "dn"], nb)
    ci_sup = H.bootstrap_factors(pc, ["config", "super"], nb)
    ci_reg = H.bootstrap_factors(pc, ["config", "region"], nb)

    # ---- pass 2: cell factors, validation, harmonized series
    log.info("pass 2: factors, validation and series, %d tiles", len(tiles))
    results = store.pmap(partial(pass2, cfg, av, win, upper, max_level), tiles, jobs, log)

    val_var = pd.concat([H.eval_finish(*collect(results, "test", v)).assign(daynight=v) for v in VARIANTS], ignore_index=True)
    test = collect(results, "test", mode)
    years = collect(results, "years", mode)
    val, val_reg, val_sup = H.eval_finish(*test), H.eval_finish(*test, by=["region"]), H.eval_finish(*test, by=["super"])
    yearly, yearly_reg, yearly_sup = (H.eval_finish(*years, by=b) for b in (["year"], ["region", "year"], ["super", "year"]))
    # month × region ratios of the years after calibration: where and when does the conversion miss?
    rmo = years[1]
    cal_end_y = pd.Timestamp(cfg["calibration"]["end"]).year
    detail = rmo[rmo["year"] > cal_end_y].groupby(["config", "super", "region", "year", "month"], as_index=False)[["harm", "v"]].sum()
    detail["ratio"] = detail["harm"] / detail["v"].where(detail["v"] > 0)
    dn_year = blocks.groupby(["config", "dn", "year"], as_index=False)[["m", "v"]].sum()
    dn_year["sensor_ratio"] = dn_year["v"] / dn_year["m"].where(dn_year["m"] > 0)
    unc = val[["config", "phi"]].assign(daynight=mode)
    for n, t in [("factors_ci", ci), ("factors_ci_dn", ci_dn), ("factors_ci_super", ci_sup), ("factors_ci_region", ci_reg),
                 ("validation", val), ("validation_daynight", val_var), ("validation_region", val_reg),
                 ("validation_super", val_sup), ("drift_by_year", yearly), ("drift_by_region_year", yearly_reg),
                 ("drift_by_super_year", yearly_sup), ("drift_detail_month", detail), ("drift_daynight_year", dn_year),
                 ("uncertainty", unc)]:
        t.to_csv(csv / f"harm_{n}.csv", index=False)

    # ---- region tables: monthly series, climatology, annual comparison
    base_years = list(range(hc["baseline_years"][0], hc["baseline_years"][1] + 1))
    mr = pd.concat([r["region_month"] for r in results if "region_month" in r], ignore_index=True)
    mr = mr.groupby(["super", "region", "year", "month"], as_index=False)[MONTHLY].sum()
    mr = mr.merge(H.median_with_zeros(mr, "region", "harm_n", base_years), on=["region", "month"], how="left")
    mr["ratio_to_median"] = mr["harm_n"] / mr["median_harm_n"].replace(0, np.nan)
    dm = av.assign(year=av.index.year, month=av.index.month, any_ok=av[[f"ok_{p}" for p in platforms]].any(axis=1),
                   ref_ok=av[f"ok_{ref}"])
    days = dm.groupby(["year", "month"]).agg(days_available=("any_ok", "sum"), days_reference=("ref_ok", "sum")).reset_index()
    mr = mr.merge(days, on=["year", "month"], how="left")
    mr.to_parquet(out / "monthly_region.parquet", index=False)
    mr.to_csv(csv / "harm_monthly_region.csv", index=False)

    ann = mr.groupby(["super", "region", "year"], as_index=False).agg(
        modis=("modis_raw_n", "sum"), viirs=("viirs_n", "sum"), harm=("harm_n", "sum"), modis_as_viirs=("modis_as_viirs_n", "sum"))
    ann["conv_over_viirs"] = ann["modis_as_viirs"] / ann["viirs"].where(ann["viirs"] > 0)   # NaN before VIIRS (backcast)
    ann.to_csv(csv / "harm_annual_region.csv", index=False)

    # ---- figures (largest groups only: a world run has ~200 regions)
    grp = "region" if mr["region"].nunique() <= 6 else "super"
    top = mr.groupby(grp)["harm_n"].sum().sort_values(ascending=False).head(6).index.tolist()
    ag = ann.groupby([grp, "year"], as_index=False)[["modis", "viirs", "harm", "modis_as_viirs"]].sum()
    calib_end = pd.Timestamp(cfg["calibration"]["end"])
    fig1, axes = plt.subplots(1, len(top), figsize=(4.6 * len(top), 4), squeeze=False)
    for ax, r in zip(axes[0], top):
        a = ag[ag[grp] == r].set_index("year")
        for lab, col in [("MODIS raw (Terra+Aqua)", "modis"), ("VIIRS raw", "viirs"),
                         ("MODIS → VIIRS-equivalent", "modis_as_viirs"), ("Harmonized series", "harm")]:
            ax.plot(a.index, a[col], marker="o", ms=3, lw=2.2 if col == "harm" else 1.3,
                    ls="--" if col == "modis_as_viirs" else "-", color=COL[lab], label=lab)
        ax.axvspan(2011.5, calib_end.year + 0.5, color="#009E73", alpha=0.08)
        ax.set_title(r); ax.set_ylim(bottom=0); ax.grid(alpha=0.3)
    axes[0][0].set_ylabel("detections / year"); axes[0][-1].legend(fontsize=8)
    fig1.suptitle("Annual detections: raw sensors and harmonized series (green: MODIS calibration period)")
    fig1.tight_layout(); fig1.savefig(fig / "harm_annual_region.png", dpi=140); plt.close(fig1)

    fig2, ax = plt.subplots(figsize=(9, 4))
    for c in yearly["config"].unique():
        s = yearly[yearly["config"] == c].set_index("year")
        ax.plot(s.index, s["harm_ratio"], marker="o", label=c)
    ax.axhline(1, color="#888888", lw=1)
    ax.axvspan(2011.5, calib_end.year + 0.5, color="#009E73", alpha=0.1, label="MODIS calibration")
    ax.set_ylabel("converted / real VIIRS"); ax.set_title("Conversion skill by year and predictor (1 = perfect)")
    ax.grid(alpha=0.3); ax.legend(fontsize=8); fig2.tight_layout(); fig2.savefig(fig / "harm_ratio_by_year.png", dpi=140); plt.close(fig2)

    last = int(mr["year"].max())
    mg = mr.groupby([grp, "year", "month"], as_index=False)["harm_n"].sum()
    mg = mg.merge(H.median_with_zeros(mg, grp, "harm_n", base_years), on=[grp, "month"], how="left")
    fig3, axes = plt.subplots(len(top), 1, figsize=(10, 2.6 * len(top)), squeeze=False)
    for ax, r in zip(axes[:, 0], top):
        s = mg[mg[grp] == r]
        med = s.drop_duplicates("month").set_index("month")["median_harm_n"].reindex(range(1, 13))
        p90 = s.drop_duplicates("month").set_index("month")["p90_harm_n"].reindex(range(1, 13))
        cur = s[s["year"] == last].set_index("month")["harm_n"].reindex(range(1, 13)).fillna(0)
        ax.bar(range(1, 13), med, color="#BBBBBB", label=f"median {base_years[0]}–{base_years[-1]}")
        ax.plot(range(1, 13), p90, color="#888888", ls=":", label="90th percentile")
        ax.plot(range(1, 13), cur, color="#D55E00", marker="o", label=str(last))
        ax.set_title(r); ax.set_xticks(range(1, 13)); ax.grid(alpha=0.3, axis="y")
    axes[0, 0].legend(fontsize=8)
    fig3.suptitle(f"Burning Activity Calendar — {last} vs. historical median (VIIRS-equivalent detections / month)")
    fig3.tight_layout(); fig3.savefig(fig / "harm_calendar_region.png", dpi=140); plt.close(fig3)

    # ---- report
    tot5 = sum(r["tot"]["n5"] for r in results if "tot" in r)
    tot1 = sum(r["tot"]["n1"] for r in results if "tot" in r)
    lev = pd.concat([r["levels"] for r in results if "levels" in r]).groupby(level=[0, 1], dropna=False).sum()
    lev = lev[lev.index.get_level_values(0) != "viirs"]      # reference days need no factor
    src_days = av.assign(s=np.where(av[f"ok_{ref}"], f"{ref} (reference)", av["config"]))["s"].value_counts()
    main_cfg = "terra+aqua" if "terra+aqua" in set(ci["config"]) else ci["config"].iat[0]
    ta = ci[ci["config"] == main_cfg].iloc[0]
    v = val[val["config"] == main_cfg].iloc[0]
    vv = val_var[val_var["config"] == main_cfg].set_index("daynight")
    better = vv["mae_harm"].idxmin() if len(vv) == 2 else mode
    post = yearly[(yearly["config"] == main_cfg) & (yearly["year"] > calib_end.year)]
    worst = detail[(detail["config"] == main_cfg) & (detail["v"] >= 500)].assign(dev=lambda d: (np.log(d["ratio"])).abs()) \
        .sort_values("dev", ascending=False).head(10).drop(columns="dev")
    phi = float(v["phi"]) if pd.notna(v["phi"]) else 1.0
    cols_v = ["cell_months", "raw_ratio", "harm_ratio", "mae_raw", "mae_harm", "pearson", "spearman_both", "r_region_month", "modis_miss"]
    piv = lambda t, i, c, val_: t.pivot_table(index=i, columns=c, values=val_).reset_index()  # noqa: E731
    S = [
        f"# Harmonization report — {cfg['aoi']['name']}",
        f"Grid: {cfg['crs']['equal_area']} (global equal-area), {len(tiles)} processing tiles, factor scale {label(fs)} · "
        f"Reference: VIIRS {ref} · QC: {q} · K = {K} · day/night factors: **{mode}** · "
        f"{mr['region'].nunique()} regions in {mr['super'].nunique()} super-regions",
        "## 1. Sources and availability",
        "Calibration window and train/test cut per predictor (month resolution):",
        md_table(pd.DataFrame([{"predictor": c, "calibration_from": ym(a), "calibration_to": ym(b), "test_from": ym(cut)}
                               for c, (a, b, cut) in win.items()])),
        "Days by source of the harmonized series: " + ", ".join(f"{k} {n:,}" for k, n in src_days.items()),
        (f"Outages applied ({len(outages)}; `known` = outages file, `detected` = domain-wide daily counts):\n\n" + md_table(outages.head(40)))
        if len(outages) else ("No outage found by the screening of domain-wide daily counts, none listed in the outages file."
                              if ac.get("detect_outages") else
                              "No outage applied. A regional run cannot detect outages: list them in the outages file or reuse "
                              "`outages_used.csv` of a world run."),
        "## 2. Conversion factors (1 predictor detection = f reference detections), 90% bootstrap interval",
        md_table(ci[["config", "f_n", "ci05", "ci95", "n_months", "m_total", "v_total"]]),
        "By day / night:", md_table(ci_dn[["config", "dn", "f_n", "ci05", "ci95", "m_total", "v_total"]]),
        f"By super-region ({main_cfg}):",
        md_table(ci_sup[ci_sup["config"] == main_cfg][["super", "f_n", "ci05", "ci95", "m_total", "v_total"]]),
        "## 3. Held-out validation inside the calibration window (cell-month, factors fitted on the train part)",
        md_table(val[["config"] + cols_v]),
        "Day/night split against one pooled factor, same held-out cell-months:",
        md_table(val_var[["config", "daynight", "harm_ratio", "mae_harm", "pearson", "r_region_month"]].sort_values(["config", "daynight"])),
        f"For {main_cfg} the lower cell-month error is obtained with **{better}** factors "
        f"(configured: {mode}; change `harmonization.daynight` if they differ).",
        md_table(val_sup[val_sup["config"] == main_cfg][["super"] + cols_v]),
        "## 4. Conversion skill by year (after the calibration window = drift check; last year = independent)",
        md_table(piv(yearly, "year", "config", "harm_ratio").rename(columns=lambda c: c if c == "year" else f"conv/ref {c}")),
        f"By super-region ({main_cfg}):",
        md_table(piv(yearly_sup[yearly_sup["config"] == main_cfg], "year", "super", "harm_ratio")),
        "Sensor ratio reference / predictor by day and night (a drift confined to one half points to overpass time):",
        md_table(piv(dn_year[dn_year["config"] == main_cfg], "year", "dn", "sensor_ratio")),
        f"Largest region-month departures after {calib_end.year} ({main_cfg}, ≥ 500 reference detections):",
        md_table(worst) if len(worst) else "none above the threshold.",
        "![ratio](../figures/harm_ratio_by_year.png)",
        "## 5. Annual series",
        "![annual](../figures/harm_annual_region.png)",
        f"## 6. Burning Activity Calendar — {last}",
        "![calendar](../figures/harm_calendar_region.png)",
        "## 7. Checks and uncertainty",
        (f"- {label(fine)} total / {label(fs)} total = {tot1 / tot5:.4f} (nesting consistency; 1.0000 expected)" if tot1 else
         f"- {label(fine)} series not written (`harmonization.fine_scale: false`)"),
        "- Factor level used on converted cell-days: " + ", ".join(f"{a}/{b} {n:,}" for (a, b), n in lev.items()),
        f"- Dispersion on held-out cell-months φ = {phi:.1f} ({main_cfg}). Approximate 90% interval of a local factor: "
        f"f · exp(± 1.645 · √φ · f_se), `f_se` being stored with every factor and every harmonized cell-day "
        "(`mvh.harmonize.interval`).",
        "## Summary",
        f"- {main_cfg} factor **{ta['f_n']:.2f}** (90%: {ta['ci05']:.2f}–{ta['ci95']:.2f}).",
        f"- Held-out converted / reference = **{v['harm_ratio']:.2f}** (raw {v['raw_ratio']:.2f}); "
        f"region-month correlation r = {v['r_region_month']:.2f}; cell-month Pearson {v['pearson']:.2f}.",
        (f"- After calibration the yearly ratio ranges {post['harm_ratio'].min():.2f}–{post['harm_ratio'].max():.2f}: "
         "aggregate consistency holds, single years can depart (see the region-month table)." if len(post) else ""),
        f"- Limit: in {100 * v['modis_miss']:.0f}% of the cell-months seen by the reference, the predictor detected nothing (small fires). "
        f"A multiplier cannot create these fires, so the cell-month absolute error (MAE {v['mae_raw']:.1f} → {v['mae_harm']:.1f}) does not improve much. "
        "The factor gets totals and the region/month pattern right; individual cell-month values remain highly uncertain.",
    ]
    (rep / "harmonization_report.md").write_text("\n\n".join(x for x in S if x) + "\n", encoding="utf-8")
    log.info("report: %s", rep / "harmonization_report.md")


if __name__ == "__main__":
    main()
