# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Overpasses and daily cell counts, tile by tile.

Outputs (data/aggregated/), one file per processing tile (and year):
    daily_<scale>_<scenario>/<tile>/<year>.parquet   cell × UTC day × platform counts (day/night split)
    overpasses/<tile>/<year>.parquet                 one row per detected overpass over the tile
    cells/<tile>.parquet                             factor-scale cells: region, super-region, totals
    platform_days/<tile>.parquet                     detections per day and platform (outage screening)
    region_month/<tile>.parquet                      detections per region, month and platform
"""
import _bootstrap  # noqa: F401

from functools import partial

import geopandas as gpd
import pandas as pd

from mvh import store
from mvh.config import ROOT, cli, load_config, path, setup_logging
from mvh.grid import label
from mvh.temporal import assign_overpasses, daily_counts, overpass_table

log = setup_logging("04_aggregate")


def scenarios(cfg) -> list[str]:
    s = cfg["qc"].get("aggregate_scenarios", "all")
    return list(cfg["qc"]["scenarios"]) if s == "all" else list(s)


def run_tile(cfg, parents: dict, force: bool, tile: str) -> int:
    det, out = path(cfg, "processed") / "detections", path(cfg, "aggregated")
    q, fs = cfg["qc"]["main_scenario"], cfg["harmonization"]["factor_scale_m"]
    cell = f"cell_{label(fs)}"
    cells_f = store.part(out / "cells", tile)
    src = [store.part(det, tile, y) for y in store.years(det, tile)]
    if not force and cells_f.exists() and all(cells_f.stat().st_mtime >= f.stat().st_mtime for f in src):
        return 0
    creg, pdays, rmon, n = [], [], [], 0
    for y in store.years(det, tile):
        df = store.read(det, tile, y)
        df = df[df["f_base_ok"]]
        if df.empty:
            continue
        df["region"] = df["region"].astype(object)
        df = assign_overpasses(df, cfg["temporal"]["overpass_gap_min"], prefix=f"{tile}_")
        overpass_table(df).to_parquet(store.part(out / "overpasses", tile, y), index=False)
        for s in cfg["grid"]["sizes_m"]:
            for scen in scenarios(cfg):
                daily_counts(df, f"cell_{label(s)}", f"q_{scen}").to_parquet(
                    store.part(out / f"daily_{label(s)}_{scen}", tile, y), index=False)
        pdays.append(df.groupby(["acq_date_utc", "platform"]).size().rename("n").reset_index()
                     .rename(columns={"acq_date_utc": "date"}))
        d = df[df[f"q_{q}"]]
        creg.append(d.assign(region=d["region"].fillna("")).groupby([cell, "region"])
                    .agg(n=("frp", "size"), frp_max=("frp", "max")).reset_index())
        rmon.append(d.assign(year=y, month=d["acq_date_utc"].dt.month).groupby(["region", "year", "month", "platform"])
                    .agg(n=("frp", "size"), frp=("frp", "sum")).reset_index())
        n += len(df)
    if creg:
        c = pd.concat(creg).groupby([cell, "region"]).agg(n=("n", "sum"), frp_max=("frp_max", "max")).reset_index()
        tot = c.groupby(cell).agg(n=("n", "sum"), frp_max=("frp_max", "max"))
        c = c[c["region"] != ""].sort_values("n", ascending=False).drop_duplicates(cell).set_index(cell)
        tot["region"] = c["region"].reindex(tot.index)          # region holding most of the cell's detections
        tot["super"] = tot["region"].map(lambda r: parents.get(r, cfg["aoi"]["name"]) if isinstance(r, str) else None)
        tot.reset_index().rename(columns={cell: "cell_id"}).to_parquet(cells_f, index=False)
        pd.concat(pdays).groupby(["date", "platform"], as_index=False)["n"].sum().to_parquet(
            store.part(out / "platform_days", tile), index=False)
        pd.concat(rmon).groupby(["region", "year", "month", "platform"], as_index=False)[["n", "frp"]].sum().to_parquet(
            store.part(out / "region_month", tile), index=False)
    return n


def main():
    args = cli(__doc__).parse_args()
    cfg = load_config(args.config)
    det = path(cfg, "processed") / "detections"
    tiles = store.select(store.tiles(det), args.tiles)
    if not tiles:
        raise SystemExit("no processed partitions — run 02_quality_control.py first")
    reg = gpd.read_file(ROOT / cfg["aoi"]["file"], ignore_geometry=True)
    parents = dict(zip(reg["name"], reg["parent"])) if "parent" in reg else {}
    log.info("%d tiles, scenarios %s", len(tiles), scenarios(cfg))
    n = store.pmap(partial(run_tile, cfg, parents, args.force), tiles, args.jobs or cfg["run"].get("jobs", 1), log)
    log.info("aggregated %d clean detections (%d tiles up to date)", sum(n), sum(1 for x in n if x == 0))


if __name__ == "__main__":
    main()
