# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mvh import harmonize as H  # noqa: E402
from mvh import grid  # noqa: E402


def synthetic_daily(true_f=4.0, seed=0):
    """Two regions, VIIRS ~ Poisson(true_f * MODIS-rate) on every day."""
    rng = np.random.default_rng(seed)
    days = pd.date_range("2012-01-20", "2020-12-31", freq="D")
    rows = []
    for c in range(40):
        region = "A" if c < 20 else "B"
        f = true_f if region == "A" else true_f * 1.5
        lam = rng.gamma(0.5, 0.4)
        for d in days[rng.random(len(days)) < 0.05]:
            terra, aqua = rng.poisson(lam * 0.6), rng.poisson(lam)
            viirs = rng.poisson(f * lam * 1.6)
            for p, n in [("Terra", terra), ("Aqua", aqua), ("S-NPP", viirs)]:
                if n:
                    rows.append({"cell_id": c, "date": d, "platform": p, "n_det": n, "frp_sum": 5.0 * n})
    df = pd.DataFrame(rows)
    return df, {c: ("A" if c < 20 else "B") for c in range(40)}


def test_factors_recover_truth_and_shrink():
    d, regions = synthetic_daily()
    plats = ["Terra", "Aqua", "S-NPP"]
    av = H.availability(plats, "2012-01-20", "2020-12-31")
    assert (av["config"] == "terra+aqua").all()
    w = H.wide_daily(d, plats)
    w["region"] = w["cell_id"].map(regions)
    rows = H.calibration_rows(w, av, "S-NPP")
    F = H.fit_factors(rows, K=50)
    ta = F["region"].query("config == 'terra+aqua'").set_index("region")["f_n"]
    assert abs(ta["A"] - 4.0) < 0.4 and abs(ta["B"] - 6.0) < 0.6
    # every cell-level factor lies between its own raw ratio and the region factor
    c = F["cell"].query("config == 'terra+aqua'").copy()
    c["own"] = c["v"] / c["m"]
    c["par"] = c["region"].map(ta)
    lo, hi = np.minimum(c["own"], c["par"]), np.maximum(c["own"], c["par"])
    assert ((c["f_n"] >= lo - 1e-9) & (c["f_n"] <= hi + 1e-9)).all()


def test_harmonized_series_uses_one_source_per_day():
    d, regions = synthetic_daily()
    plats = ["Terra", "Aqua", "S-NPP"]
    outages = pd.DataFrame({"platform": ["S-NPP"], "start": ["2015-06-01"], "end": ["2015-06-30"]})
    av = H.availability(plats, "2012-01-20", "2020-12-31", None, outages)
    w = H.wide_daily(d, plats)
    w["region"] = w["cell_id"].map(regions)
    F = H.fit_factors(H.calibration_rows(w, av, "S-NPP"), K=50)
    h = H.harmonize_daily(w, av, F, "S-NPP")
    june = h["date"].between("2015-06-01", "2015-06-30")
    assert (h.loc[june, "source"] == "modis_harmonized").all()
    assert np.allclose(h.loc[june, "harm_n"], h.loc[june, "modis_n"] * h.loc[june, "f_n"])
    assert (h.loc[~june, "harm_n"] == h.loc[~june, "n_S-NPP"]).all()
    # converted MODIS reproduces VIIRS in aggregate
    ratio = h.loc[~june, "modis_as_viirs_n"].sum() / h.loc[~june, "n_S-NPP"].sum()
    assert 0.9 < ratio < 1.1


def test_median_with_zeros_counts_missing_years():
    m = pd.DataFrame({"unit": ["x", "x"], "year": [2012, 2013], "month": [7, 7], "v": [10.0, 20.0]})
    med = H.median_with_zeros(m, "unit", "v", [2012, 2013, 2014, 2015, 2016])
    assert med.query("month == 7")["median_v"].iat[0] == 0.0   # 10, 20, 0, 0, 0 -> 0
    m2 = m.assign(year=[2012, 2013])
    med2 = H.median_with_zeros(m2, "unit", "v", [2012, 2013, 2014])
    assert med2.query("month == 7")["median_v"].iat[0] == 10.0


def test_parent_ids_nest():
    i = np.array([12, 14, 15, -1]); j = np.array([7, 9, 10, -1])
    par = grid.parent_ids(grid.pack(i, j), 1000, 5000)
    assert grid.cell_label(par, 5000).tolist() == ["5kmE2N1", "5kmE2N1", "5kmE3N2", "5kmE-1N-1"]
    assert all(a.tolist() == b.tolist() for a, b in zip(grid.unpack(grid.pack(i, j)), (i, j)))


# ----------------------------------------------------------------------------- global-scale behaviour
def _rows(split_dn=False, seed=1):
    """Daily calibration rows over 2 super-regions / 4 regions, optionally with distinct day/night ratios."""
    rng = np.random.default_rng(seed)
    days = pd.date_range("2012-01-20", "2019-12-31", freq="D")
    rows = []
    for c in range(60):
        region = f"R{c % 4}"
        lam = rng.gamma(0.5, 0.6)
        for d in days[rng.random(len(days)) < 0.04]:
            for dn, f in ((("D", 3.0), ("N", 8.0)) if split_dn else (("all", 4.0),)):
                m = rng.poisson(lam)
                v = rng.poisson(f * lam * (1.5 if c % 4 >= 2 else 1.0))
                if m or v:
                    rows.append({"config": "terra+aqua", "dn": dn, "super": f"S{c % 4 // 2}", "region": region, "cell_id": c,
                                 "date": d, "year": d.year, "month": d.month, "m": m, "v": v, "m_frp": 5.0 * m, "v_frp": 2.0 * v})
    return pd.DataFrame(rows)


def test_tilewise_fit_equals_single_fit():
    """Upper levels from domain-wide region×month sums + cell levels per tile = the one-shot fit."""
    rows = _rows()
    full = H.fit_factors(rows, K=50)
    blocks = rows.groupby(H.STRATA + ["super", "region", "year", "month"], as_index=False)[H.SUMS].sum()
    upper = H.fit_factors(blocks, K=50, levels=H.UPPER)
    assert set(upper) == set(H.UPPER)
    parts = []
    for tile_cells in (range(0, 25), range(25, 60)):            # two "tiles"
        cm = H.to_cm(rows[rows["cell_id"].isin(tile_cells)])
        parts.append(H.fit_factors(cm, K=50, upper=upper)["cell_month"])
    a = pd.concat(parts).sort_values(["cell_id", "month"])["f_n"].to_numpy()
    b = full["cell_month"].sort_values(["cell_id", "month"])["f_n"].to_numpy()
    assert np.allclose(a, b)


def test_daynight_factors_and_pooled_view():
    rows = _rows(split_dn=True)
    F = H.fit_factors(rows, K=50)
    top = F["all"].set_index("dn")["f_n"]
    assert abs(top["D"] / 3.75 - 1) < 0.1 and abs(top["N"] / 10.0 - 1) < 0.1     # ×1.25 = mean regional effect
    pooled = H.fit_factors(H.collapse_dn(H.to_cm(rows)), K=50)["all"]
    assert set(pooled["dn"]) == {"all"} and top["D"] < pooled["f_n"].iat[0] < top["N"]
    # both variants are scored on identical cell-months, day + night summed
    e1, e2 = H.evaluate(rows, F), H.evaluate(H.collapse_dn(H.to_cm(rows)), H.fit_factors(H.collapse_dn(H.to_cm(rows)), K=50))
    assert e1["cell_months"].iat[0] == e2["cell_months"].iat[0] and abs(e1["harm_ratio"].iat[0] - 1) < 0.05


def test_evaluation_moments_match_direct_computation():
    rows = _rows()
    F = H.fit_factors(rows, K=50)
    s = H.eval_cells(H.to_cm(rows), F)
    # accumulate in two pieces, as two tiles would
    p1, p2 = H.eval_parts(s[s["cell_id"] < 30]), H.eval_parts(s[s["cell_id"] >= 30])
    out = H.eval_finish(*(pd.concat([a, b]) for a, b in zip(p1, p2)))
    assert np.isclose(out["pearson"].iat[0], s["harm"].corr(s["v"]))
    assert np.isclose(out["mae_harm"].iat[0], (s["harm"] - s["v"]).abs().mean())
    assert np.isclose(out["harm_ratio"].iat[0], s["harm"].sum() / s["v"].sum())


def test_factor_uncertainty_shrinks_with_data():
    F = H.fit_factors(_rows(), K=50)
    c = F["cell"]
    assert (c["f_se"] > 0).all()
    assert c.loc[c["m"] > c["m"].median(), "f_se"].mean() < c.loc[c["m"] <= c["m"].median(), "f_se"].mean()
    lo, hi = H.interval(c["f_n"], c["f_se"], phi=4.0)
    lo1, hi1 = H.interval(c["f_n"], c["f_se"], phi=1.0)
    assert (lo < lo1).all() and (hi > hi1).all() and (lo > 0).all()
    # region factors of the synthetic truth (4.0 / 6.0) fall inside their 90 % interval
    r = F["region"]
    lo, hi = H.interval(r["f_n"], r["f_se"], phi=1.0, z=2.6)
    truth = r["region"].map({"R0": 4.0, "R1": 4.0, "R2": 6.0, "R3": 6.0})
    assert ((lo <= truth) & (truth <= hi)).all()


def test_backup_viirs_platform_fills_reference_outage():
    """S-NPP down → NOAA-20 × its factor (not MODIS, not a sum); nothing available → missing."""
    rng = np.random.default_rng(3)
    days = pd.date_range("2019-01-01", "2020-12-31", freq="D")
    rows = []
    for c in range(20):
        for d in days[rng.random(len(days)) < 0.2]:
            lam = rng.gamma(2.0, 2.0)
            for p, mu in (("Terra", 0.4 * lam), ("Aqua", 0.6 * lam), ("S-NPP", 3 * lam), ("NOAA-20", 3.3 * lam)):
                n = rng.poisson(mu)
                if n:
                    rows.append({"cell_id": c, "date": d, "platform": p, "n_det": n, "frp_sum": 2.0 * n,
                                 "n_day": n, "frp_day": 2.0 * n})
    d = pd.DataFrame(rows)
    preds = H.predictors({"predictors": [
        {"name": "noaa-20", "platforms": ["NOAA-20"], "sensor": "VIIRS", "max_level": "region"},
        {"name": "terra+aqua", "platforms": ["Terra", "Aqua"]}]})
    plats = ["S-NPP", "NOAA-20", "Terra", "Aqua"]
    out = pd.DataFrame({"platform": ["S-NPP", "S-NPP", "NOAA-20", "Terra"],
                        "start": ["2020-03-01", "2020-06-01", "2020-06-01", "2020-06-01"],
                        "end": ["2020-03-31", "2020-06-30", "2020-06-30", "2020-06-10"]})
    av = H.availability(plats, "2019-01-01", "2020-12-31", None, out, preds)
    assert av.loc["2020-03-15", "config"] == "noaa-20" and av.loc["2020-03-15", "config_modis"] == "terra+aqua"
    assert av.loc["2020-06-05", "config"] == "none" and av.loc["2020-06-20", "config"] == "terra+aqua"
    w = H.wide_daily(d, plats)
    w["region"] = "A"
    F = H.fit_factors(H.calibration_rows(w, av, "S-NPP", preds), K=50, max_level={"noaa-20": "region"})
    assert "noaa-20" not in set(F["cell"]["config"]) and "noaa-20" in set(F["region"]["config"])
    f20 = F["region"].query("config == 'noaa-20'")["f_n"].iat[0]
    assert abs(f20 - 3 / 3.3) < 0.03
    h = H.harmonize_daily(w, av, F, "S-NPP", preds=preds)
    march = h["date"].between("2020-03-01", "2020-03-31")
    assert (h.loc[march, "source"] == "viirs_backup").all()
    assert np.allclose(h.loc[march, "harm_n"], h.loc[march, "n_NOAA-20"] * f20)
    gap = h["date"].between("2020-06-01", "2020-06-10")
    assert (h.loc[gap, "source"] == "missing").all() and h.loc[gap, "harm_n"].isna().all()
    # the MODIS counterfactual is still available on backup days, for validation
    assert (h.loc[march, "modis_as_viirs_n"] >= 0).all() and h.loc[march, "modis_as_viirs_n"].sum() > 0


def test_detect_outages_from_domain_counts():
    rng = np.random.default_rng(0)
    days = pd.date_range("2015-01-01", "2019-12-31", freq="D")
    level = 800 * (1 + 0.6 * np.sin(2 * np.pi * days.dayofyear / 365.25))
    c = pd.DataFrame({"date": days, "platform": "Aqua", "n": rng.poisson(level)})
    c.loc[c["date"].between("2017-08-16", "2017-09-02"), "n"] = 0          # 18-day outage
    c.loc[c["date"] == "2018-02-10", "n"] = 3                              # single bad day
    quiet = pd.DataFrame({"date": days, "platform": "Tiny", "n": rng.poisson(5, len(days))})   # regional-like: never screened
    o = H.detect_outages(pd.concat([c, quiet]), window=61, frac=0.1, min_level=200)
    assert set(o["platform"]) == {"Aqua"}
    assert [(r.start, r.end) for r in o.itertuples()] == [("2017-08-16", "2017-09-02"), ("2018-02-10", "2018-02-10")]
