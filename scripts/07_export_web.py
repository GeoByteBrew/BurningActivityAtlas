# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Export compact JSON datasets for the web dashboard (web/public/data/<dataset>/).

A dataset is one self-contained folder the app can load: an *overview* (coarse cells over the
whole domain, regions = super-regions, no single detections) or a *detail window* (5 km cells and
detections inside a bbox, regions = countries / sub-regions). `datasets.json` lists them; the app
shows a dataset switcher when there is more than one. Configure them under `web:` in the config.

Inputs : data/harmonized/ (monthly_<scale>/<tile>.parquet, availability.csv),
         data/aggregated/ (cells, region_month), data/processed/detections (detail windows),
         outputs/csv/harm_*.csv (validation tables)
Outputs: datasets.json and, per dataset: meta.json, aoi.json, cells.json, cells_monthly.json,
         series.json, validation.json, points_<year>.json (detail windows)
"""
import _bootstrap  # noqa: F401

import json
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box

from mvh import harmonize as H
from mvh import store
from mvh.config import ROOT, cli, load_config, path, record_start, setup_logging
from mvh.grid import cell_bounds, cell_label, label, parent_ids, tile_bounds

log = setup_logging("07_export_web")
AI_USE = ("Computed from NASA FIRMS detections by a pipeline whose code was written with the assistance of a "
          "large language model (Claude, Anthropic). No value was produced by a generative model. See AI_USE.md.")
LAYERS = {"modis": "modis_raw_n", "viirs": "viirs_n", "harm": "harm_n", "conv": "modis_as_viirs_n"}


def dump(obj, f):
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    log.info("  wrote %s/%s (%.1f KB)", f.parent.name, f.name, f.stat().st_size / 1024)


def records(f, where=None) -> list[dict]:
    if not f.exists():
        return []
    d = pd.read_csv(f)
    if where is not None and len(d):
        d = d[where(d)]
    return json.loads(d.round(4).to_json(orient="records"))


def calendar_median(values: np.ndarray, months: list[str], base_years: set[int]) -> list[float]:
    """Median per calendar month over the baseline years (months without activity count as 0)."""
    out = []
    for m in range(1, 13):
        v = [values[k] for k, ym in enumerate(months) if int(ym[5:7]) == m and int(ym[:4]) in base_years]
        out.append(round(float(np.median(v)), 2) if v else 0.0)
    return out


def tiles_in(cfg, tiles, bbox):
    fs, tc, crs = cfg["harmonization"]["factor_scale_m"], cfg["grid"]["tile_cells"], cfg["crs"]["equal_area"]
    w, s, e, n = bbox
    keep = []
    for t in tiles:
        tw, ts, te, tn = tile_bounds(t, tc, fs, crs)
        if tw <= e and te >= w and ts <= n and tn >= s:
            keep.append(t)
    return keep


def export_dataset(cfg, ds: dict, out, overview: bool) -> dict | None:
    hc, wc = cfg["harmonization"], cfg["web"]
    crs, q = cfg["crs"]["equal_area"], cfg["qc"]["main_scenario"]
    ref, fs = hc["reference_platform"], hc["factor_scale_m"]
    preds = H.predictors(hc)
    modis_pl = sorted({s for p in preds if p["sensor"] == "MODIS" for s in p["platforms"]}, key=["Terra", "Aqua"].index)
    agg, harm, csv, proc = path(cfg, "aggregated"), path(cfg, "harmonized"), path(cfg, "csv"), path(cfg, "processed")
    base_years = list(range(hc["baseline_years"][0], hc["baseline_years"][1] + 1))
    bbox = ds.get("bbox") or cfg["aoi"]["bbox_wgs84"]
    # cell_m may coarsen a detail window (e.g. 10 km mid step); default = factor scale (5 km)
    size = int(ds.get("cell_m", fs))
    if size % fs:
        raise SystemExit(f"dataset {ds['id']}: cell_m={size} must be a multiple of {fs}")
    kind = ds.get("kind") or ("overview" if overview else "detail")
    level = ds.get("region_level", "super" if overview or kind == "overview" else "region")
    clipped = ds.get("bbox") is not None                       # a window inside the domain
    # global runs: keep cells inside the domain bbox only (detections processed before the bbox
    # flag existed may lie beyond it, e.g. Antarctica)
    in_domain = clipped or not cfg["aoi"].get("clip", True)
    log.info("dataset %s: %s cells, kind=%s, regions = %s, bbox %s", ds["id"], label(size), kind, level, bbox)

    # ---- cell × month table inside the bbox, at the dataset's cell size
    # overview (super): keep UN sub-region + country so the UI can drill into countries
    dual = level == "super"
    mroot = harm / f"monthly_{label(fs)}"
    tiles = tiles_in(cfg, store.tiles(mroot), bbox)
    frames, cframes = [], []
    for t in tiles:
        m = store.read(mroot, t, columns=["cell_id", "region", "super", "year", "month", *LAYERS.values()])
        c = store.read(agg / "cells", t, columns=["cell_id", "n", "frp_max"])
        if in_domain:
            b = cell_bounds(c["cell_id"], fs, crs)
            cx, cy = ((b["w"] + b["e"]) / 2).to_numpy(), ((b["s"] + b["n"]) / 2).to_numpy()
            c = c[(cx >= bbox[0]) & (cx <= bbox[2]) & (cy >= bbox[1]) & (cy <= bbox[3])]
            m = m[m["cell_id"].isin(c["cell_id"])]
        if dual:
            m = m.rename(columns={"super": "reg", "region": "country"})
            m["reg"] = m["reg"].astype(object)
            m["country"] = m["country"].astype(object)
            gcols = ["cell_id", "reg", "country", "year", "month"]
        else:
            m = m.rename(columns={level: "reg"})
            m["reg"] = m["reg"].astype(object)
            gcols = ["cell_id", "reg", "year", "month"]
        if size != fs:
            m["cell_id"] = parent_ids(m["cell_id"], fs, size)
            c = c.assign(cell_id=parent_ids(c["cell_id"], fs, size))
        frames.append(m.groupby(gcols, as_index=False, dropna=False)[list(LAYERS.values())].sum())
        cframes.append(c)
    frames = [f for f in frames if len(f)]
    if not frames:
        log.warning("dataset %s: no harmonized data inside the bbox — skipped", ds["id"])
        return None
    m = pd.concat(frames, ignore_index=True)

    def majority(col: str) -> pd.Series:
        top = m.groupby(["cell_id", col], dropna=False)["harm_n"].sum().reset_index().sort_values("harm_n", ascending=False)
        return top.dropna(subset=[col]).drop_duplicates("cell_id").set_index("cell_id")[col]

    # a coarse cell takes the region (and country) holding most of its harmonized activity
    creg = majority("reg")
    ccountry = majority("country") if dual else None
    m = m.groupby(["cell_id", "year", "month"], as_index=False)[list(LAYERS.values())].sum()
    m["reg"] = m["cell_id"].map(creg)
    if dual:
        m["country"] = m["cell_id"].map(ccountry)
    cells = pd.concat(cframes).groupby("cell_id").agg(n_det=("n", "sum"), frp_max=("frp_max", "max")).reindex(pd.unique(m["cell_id"]))
    cells = cells.reset_index()
    cells["reg"] = cells["cell_id"].map(creg)
    if dual:
        cells["country"] = cells["cell_id"].map(ccountry)
    regions = sorted(r for r in cells["reg"].dropna().unique() if r != H.NO_REGION)
    countries = sorted(r for r in cells["country"].dropna().unique() if r != H.NO_REGION) if dual else []
    cells = pd.concat([cells, cell_bounds(cells["cell_id"], size, crs)], axis=1)
    if len(cells) > wc.get("max_cells", 80000):
        log.warning("dataset %s has %d cells (> web.max_cells): the browser will be slow — use a larger cell_m or a smaller bbox",
                    ds["id"], len(cells))
    idx = pd.Series(np.arange(len(cells)), index=cells["cell_id"])

    y0, y1 = pd.Timestamp(record_start(cfg)).year, pd.Timestamp(cfg["period"]["end"]).year
    years = list(range(y0, y1 + 1))
    mkeys = [str(p) for p in pd.period_range(f"{y0}-01", f"{y1}-12", freq="M")]
    m["k"] = (m["year"] - y0) * 12 + m["month"] - 1
    m = m[(m["k"] >= 0) & (m["k"] < len(mkeys))]
    m["c"] = idx.reindex(m["cell_id"]).to_numpy()

    def season(col):
        a = np.zeros((len(cells), 12))
        s = m.groupby(["c", "month"])[col].sum()
        a[s.index.get_level_values(0), s.index.get_level_values(1) - 1] = s.to_numpy()
        return np.round(a).astype(int).ravel().tolist()

    ridx = {r: i for i, r in enumerate(regions)}
    cidx = {r: i for i, r in enumerate(countries)} if dual else {}
    cells_out = {
        "size_m": size, "regions": regions, "id": cell_label(cells["cell_id"], size).tolist(),
        "w": cells["w"].tolist(), "s": cells["s"].tolist(), "e": cells["e"].tolist(), "n": cells["n"].tolist(),
        "region": [ridx.get(r, -1) for r in cells["reg"]],
        "frp_max": cells["frp_max"].round(1).fillna(0).tolist(),
        "modis_m": season("modis_raw_n"), "viirs_m": season("viirs_n"),
    }
    if dual:
        cells_out["countries"] = countries
        cells_out["country"] = [cidx.get(r, -1) for r in cells["country"]]
    dump(cells_out, out / "cells.json")

    def sparse(col, digits):
        s = m[m[col] != 0]
        v = s[col].round(digits)
        return {"c": s["c"].tolist(), "k": s["k"].tolist(), "v": (v if digits else v.astype(int)).tolist()}

    coarse = size != fs
    monthly = {"months": mkeys, "modis": sparse("modis_raw_n", 0), "viirs": sparse("viirs_n", 0),
               "harm": sparse("harm_n", 0 if coarse else 2), "conv": sparse("modis_as_viirs_n", 0 if coarse else 2)}
    med = H.median_with_zeros(m, "c", "harm_n", base_years)
    med = med[med["median_harm_n"] > 0]
    monthly["median"] = {"c": med["c"].tolist(), "m": (med["month"] - 1).tolist(), "v": med["median_harm_n"].round(2).tolist()}
    dump(monthly, out / "cells_monthly.json")

    # ---- raw detections per platform: region × month counts (and points for detail windows)
    reg_file = gpd.read_file(ROOT / cfg["aoi"]["file"]).to_crs("EPSG:4326")
    parent = dict(zip(reg_file["name"], reg_file["parent"])) if "parent" in reg_file else {}
    # mid-scale windows stay grid-only; detections belong on the 5 km detail datasets
    has_points = kind == "detail" and ds.get("points", True) and size <= fs
    rm_country = None
    if overview or kind == "overview" or kind == "coarse" or not has_points:
        rm_src = store.read_all(agg / "region_month")
        if dual:
            # keep country-level rows for drill-down series; aggregate to super for the region list
            rm_country = rm_src.copy()
            rm_country["reg"] = rm_country["region"]
            if countries:
                rm_country = rm_country[rm_country["reg"].isin(countries)]
            rm_country = rm_country.groupby(["reg", "year", "month", "platform"], as_index=False)[["n", "frp"]].sum()
            rm = rm_src.copy()
            rm["reg"] = rm["region"].map(parent)
            rm = rm.groupby(["reg", "year", "month", "platform"], as_index=False)[["n", "frp"]].sum()
        else:
            rm = rm_src.copy()
            rm["reg"] = rm["region"].map(parent) if level == "super" else rm["region"]
            if clipped:
                rm = rm[rm["reg"].isin(regions)]
            rm = rm.groupby(["reg", "year", "month", "platform"], as_index=False)[["n", "frp"]].sum()
    else:
        cols = ["platform", "latitude", "longitude", "acq_datetime", "daynight", "frp", "region", f"q_{q}"]
        det = proc / "detections"
        parts, n_cut = [], 0
        for y in years:
            fr = [store.read(det, t, y, columns=cols) for t in tiles_in(cfg, store.tiles(det), bbox) if y in store.years(det, t)]
            if not fr:
                continue
            d = pd.concat(fr, ignore_index=True)
            d = d[d[f"q_{q}"] & d["longitude"].between(bbox[0], bbox[2]) & d["latitude"].between(bbox[1], bbox[3])]
            d = d.assign(region=d["region"].astype(object), platform=d["platform"].astype(str),
                         date=d["acq_datetime"].dt.tz_convert(None))
            d["reg"] = d["region"].map(parent) if level == "super" else d["region"]
            parts.append(d.assign(year=y, month=d["date"].dt.month).groupby(["reg", "year", "month", "platform"])
                         .agg(n=("frp", "size"), frp=("frp", "sum")).reset_index())
            cap = wc.get("max_points_per_year", 400000)
            if len(d) > cap:
                n_cut += len(d) - cap
                d = d.nlargest(cap, "frp")
            d = d.sort_values("date")
            ds.setdefault("_points", []).append((y, d))
        rm = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["reg", "year", "month", "platform", "n", "frp"])
        ds["_cut"] = n_cut
    platforms = sorted(rm["platform"].unique(), key=lambda p: (p not in modis_pl, p))
    for frame in (rm, rm_country):
        if frame is None or not len(frame):
            continue
        frame["ym"] = pd.PeriodIndex.from_fields(year=frame["year"], month=frame["month"], freq="M").astype(str)
        frame["group"] = np.where(frame["platform"].isin(modis_pl), "modis", np.where(frame["platform"] == ref, "viirs", "other"))

    av = pd.read_csv(harm / "availability.csv", parse_dates=["date"])
    okc = [c for c in av.columns if c.startswith("ok_")]
    days = av.assign(ym=av["date"].dt.to_period("M").astype(str), ok=av[okc].any(axis=1)).groupby("ym")["ok"].sum() \
        .reindex(mkeys, fill_value=0).astype(int).tolist()
    m["ym"] = np.array(mkeys)[m["k"].to_numpy()]

    def fill_series(keys: list[str], counts: pd.DataFrame, place_col: str):
        out = {}
        for r in keys:
            sub = counts if r == "All" else counts[counts["reg"] == r]
            hs = m if r == "All" else m[m[place_col] == r]
            per = lambda d, col: d.groupby("ym")[col].sum().reindex(mkeys, fill_value=0)  # noqa: E731
            h = per(hs, "harm_n")
            out[r] = {
                "count": {p: per(sub[sub["platform"] == p], "n").astype(int).tolist() for p in platforms},
                "frp": {g: per(sub[sub["group"] == g], "frp").round(1).tolist() for g in ("modis", "viirs")},
                "harm": h.round(1).tolist(), "conv": per(hs, "modis_as_viirs_n").round(1).tolist(),
                "median": calendar_median(h.to_numpy(), mkeys, set(base_years)), "days": days,
            }
        return out

    series = {"months": mkeys, "platforms": platforms, "regions": fill_series(["All"] + regions, rm, "reg")}
    if dual and rm_country is not None and countries:
        series["regions"].update(fill_series(countries, rm_country, "country"))
    dump(series, out / "series.json")

    # ---- validation tables (domain-wide fit; regional rows limited to this dataset's regions)
    ta = lambda d: d["config"] == "terra+aqua" if "config" in d else pd.Series(True, index=d.index)  # noqa: E731
    lv = "super" if level == "super" else "region"
    # regional rows: this dataset's regions, and enough predictor detections for the ratio to mean something
    in_ds = lambda d: ta(d) & d[lv].isin(regions) & (d["m_total"] >= 1000 if "m_total" in d else True)  # noqa: E731
    as_region = lambda rows: [{**r, "region": r.get(lv)} for r in rows]  # noqa: E731
    ann = m.assign(region=m["reg"]).dropna(subset=["region"]).groupby(["region", "year"], as_index=False).agg(
        modis=("modis_raw_n", "sum"), viirs=("viirs_n", "sum"), harm=("harm_n", "sum"), modis_as_viirs=("modis_as_viirs_n", "sum"))
    ann["conv_over_viirs"] = ann["modis_as_viirs"] / ann["viirs"].where(ann["viirs"] > 0)
    dump({
        "scope": cfg["aoi"]["name"],
        "factors": records(csv / "harm_factors_ci.csv"),
        "factors_dn": records(csv / "harm_factors_ci_dn.csv"),
        "factors_region": as_region(records(csv / f"harm_factors_ci_{lv}.csv", in_ds)),
        "test": records(csv / "harm_validation.csv"),
        "test_daynight": records(csv / "harm_validation_daynight.csv"),
        "test_region": as_region(records(csv / f"harm_validation_{lv}.csv", in_ds)),
        "by_year": records(csv / "harm_drift_by_year.csv"),
        "by_region_year": as_region(records(csv / f"harm_drift_by_{lv}_year.csv", in_ds)),
        "annual_region": json.loads(ann.round(4).to_json(orient="records")),
        "uncertainty": records(csv / "harm_uncertainty.csv"),
        "outages": records(harm / "outages_used.csv"),
    }, out / "validation.json")

    # ---- region outlines (super dissolve + countries when dual)
    simp = 0.02 if overview or kind in ("overview", "coarse") else 0.004
    if dual:
        # dissolve only geometry by parent — country `name` would otherwise duplicate the column
        supers = reg_file[["parent", "geometry"]].dissolve("parent").reset_index().rename(columns={"parent": "name"})
        supers = supers[supers["name"].isin(regions)].assign(level="super", parent=pd.NA)
        ctr = reg_file[reg_file["name"].isin(countries)][["name", "parent", "geometry"]].copy()
        ctr = ctr.assign(level="country")
        g = gpd.GeoDataFrame(
            pd.concat([supers[["name", "parent", "level", "geometry"]],
                       ctr[["name", "parent", "level", "geometry"]]], ignore_index=True),
            geometry="geometry", crs=reg_file.crs,
        )
    else:
        g = reg_file[reg_file["name"].isin(regions)].copy()
        g = g.assign(level="region", parent=g["parent"] if "parent" in g else None)
        keep = [c for c in ("name", "parent", "level", "geometry") if c in g.columns]
        g = g[keep]
    # Gentle simplify: coarse 0.08° made country borders look like zig-zags on the globe.
    g = g.assign(geometry=g.geometry.intersection(box(*bbox)).simplify(simp, preserve_topology=True))
    g = g[~g.geometry.is_empty]
    aoi_json = json.loads(g.to_json())
    for feat in aoi_json["features"]:
        feat.pop("id", None)
        props = feat.get("properties") or {}
        if props.get("parent") is None:
            props.pop("parent", None)
        feat["properties"] = props
    dump(aoi_json, out / "aoi.json")

    # ---- detection points per year (detail windows)
    pidx = {p: i for i, p in enumerate(platforms)}
    for y, d in ds.pop("_points", []):
        dump({"lon": d["longitude"].round(4).tolist(), "lat": d["latitude"].round(4).tolist(),
              "frp": d["frp"].round(1).fillna(0).tolist(), "p": d["platform"].map(pidx).tolist(),
              "doy": d["date"].dt.day_of_year.tolist(), "night": (d["daynight"] == "N").astype(int).tolist(),
              "r": d["reg"].map(ridx).fillna(-1).astype(int).tolist()}, out / f"points_{y}.json")

    # ---- metadata
    cov = rm.groupby("platform").agg(start=("ym", "min"), end=("ym", "max"), n=("n", "sum"))
    op = hc.get("operational", {})
    qcf = proc / "qc_summary.csv"
    cal = cfg["calibration"]
    meta = {
        "title": "Burning Activity Atlas", "dataset": ds["id"], "region_name": ds.get("name", cfg["aoi"]["name"]),
        "bbox": bbox, "period": [record_start(cfg), cfg["period"]["end"]], "viirs_start": cfg["period"]["start"],
        "years": years, "regions": regions, "region_level": level, "platforms": platforms,
        "modis_platforms": modis_pl, "reference_platform": ref,
        "backup_platforms": [s for p in preds if p["sensor"] == "VIIRS" for s in p["platforms"]],
        "daynight": hc.get("daynight", "split"),
        "qc_scenario": q, "qc_description": cfg["qc"]["scenarios"][q]["description"],
        "cell_size_m": size, "n_cells": len(cells), "harmonized": True, "points": bool(has_points),
        "points_dropped": int(ds.pop("_cut", 0)), "validation_scope": cfg["aoi"]["name"],
        "calibration": {"end": cal["end"], "drift_test": cal["drift_test"],
                        "independent_test": cal["independent_test"], "baseline_years": hc["baseline_years"]},
        "coverage": {p: {"start": max(f"{r['start']}-01", str((op.get(p) or [None])[0] or "")), "end": f"{r['end']}-28", "n": int(r["n"])}
                     for p, r in cov.iterrows()},
        "qc_summary": pd.read_csv(qcf).to_dict(orient="records") if qcf.exists() and not clipped else [],
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "ai_use": AI_USE,
    }
    if dual:
        region_countries: dict[str, list[str]] = {r: [] for r in regions}
        for cname in countries:
            p = parent.get(cname)
            if p in region_countries:
                region_countries[p].append(cname)
        for r in region_countries:
            region_countries[r].sort()
        meta["countries"] = countries
        meta["region_countries"] = region_countries
    dump(meta, out / "meta.json")
    return {"id": ds["id"], "name": meta["region_name"], "path": ds["id"], "bbox": bbox, "cell_size_m": size,
            "kind": kind, "n_cells": len(cells)}


def web_todo(wc: dict, fs: int) -> list[tuple[dict, bool]]:
    """overview (e.g. 50 km) → world 25 km → regional 10 km mid → 5 km detail."""
    todo: list[tuple[dict, bool]] = []
    if wc.get("overview"):
        o = dict(wc["overview"])
        o.setdefault("kind", "overview")
        todo.append((o, True))
        # World zoom step between overview and regional windows (skip if overview is already ≤25 km)
        if int(o.get("cell_m", fs)) > 25000:
            coarse = dict(o)
            coarse["id"] = f"{o['id']}_25km"
            coarse["cell_m"] = 25000
            coarse["kind"] = "coarse"
            coarse.setdefault("name", o.get("name", o["id"]))
            todo.append((coarse, True))
    details = list(wc.get("details") or [])
    for d in details:
        mid = dict(d)
        mid["id"] = f"{d['id']}_10km"
        mid["cell_m"] = 10000
        mid["points"] = False
        mid["kind"] = "mid"
        mid.setdefault("name", d.get("name", d["id"]))
        todo.append((mid, False))
    for d in details:
        det = dict(d)
        det.setdefault("kind", "detail")
        det.setdefault("cell_m", fs)
        todo.append((det, False))
    return todo


def main():
    ap = cli(__doc__)
    ap.add_argument("--out", default="web/public/data", help="output directory (relative to the project root)")
    ap.add_argument("--only", help="comma-separated dataset ids to (re)export")
    args = ap.parse_args()
    out = ROOT / args.out
    cfg = load_config(args.config)
    fs = cfg["harmonization"]["factor_scale_m"]
    if not store.tiles(path(cfg, "harmonized") / f"monthly_{label(fs)}"):
        raise SystemExit("no harmonized monthly tables — run 06_harmonize.py first")
    only = set(args.only.split(",")) if args.only else None
    wc = cfg.get("web", {})
    todo = web_todo(wc, fs)
    index_f = out / "datasets.json"
    wanted = {d["id"] for d, _ in todo}
    old = {d["id"]: d for d in json.loads(index_f.read_text())["datasets"]} if index_f.exists() else {}
    index = {k: v for k, v in old.items() if k in wanted and (out / k / "meta.json").exists()}
    for k in sorted(set(old) - wanted):
        log.info("dataset %s is not in this configuration: removed from datasets.json (its folder is left in place)", k)
    for ds, overview in todo:
        if only and ds["id"] not in only:
            continue
        entry = export_dataset(cfg, dict(ds), out / ds["id"], overview)
        if entry:
            index[ds["id"]] = entry
    order = [d["id"] for d, _ in todo]
    datasets = sorted(index.values(), key=lambda d: order.index(d["id"]) if d["id"] in order else len(order))
    default = next((d["id"] for d in datasets if d.get("kind") == "overview"), datasets[0]["id"] if datasets else None)
    dump({"default": default, "datasets": datasets}, index_f)


if __name__ == "__main__":
    main()
