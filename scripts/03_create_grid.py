"""Grid layers in the global EPSG:6933 grid.

Regional run: sizes listed in grid.materialize_m are written as polygon layers over the AOI.
World run (materialize_m empty): nothing is materialized — a global 5 km layer would hold
~20 M polygons. Cells exist as integer ids; polygons are derived on demand for non-empty cells
(mvh.grid.cells_to_polygons). This script then only reports the grid and tile layout.
"""
import _bootstrap  # noqa: F401

import geopandas as gpd

from mvh.config import ROOT, cli, load_config, path, setup_logging
from mvh.grid import build_grid, label, project

log = setup_logging("03_grid")


def main():
    cfg = load_config(cli(__doc__).parse_args().config)
    aoi = gpd.read_file(ROOT / cfg["aoi"]["file"]).to_crs(cfg["crs"]["equal_area"])
    sizes = sorted(cfg["grid"]["sizes_m"])
    out = path(cfg, "grids")
    fs, tc = cfg["harmonization"]["factor_scale_m"], cfg["grid"]["tile_cells"]
    w, s, e, n = cfg["aoi"]["bbox_wgs84"]
    (x0, x1), (y0, y1) = project([w, e], [max(s, -84), min(n, 84)], cfg["crs"]["equal_area"])
    step = fs * tc
    log.info("processing tiles: %d × %d cells of %s = %.0f km; up to %d tiles over the bbox",
             tc, tc, label(fs), step / 1000, (int(x1 // step) - int(x0 // step) + 1) * (int(y1 // step) - int(y0 // step) + 1))
    for k, sz in enumerate(sizes):
        if sz not in cfg["grid"].get("materialize_m", sizes):
            log.info("%s: not materialized (on demand) — ~%.1f M cells over the regions", label(sz), aoi.area.sum() / sz**2 / 1e6)
            continue
        parent = sizes[k + 1] if k + 1 < len(sizes) else None
        g = build_grid(aoi, sz, buffer_m=cfg["aoi"]["buffer_m"], parent_size_m=parent)
        f = out / f"grid_{label(sz)}.gpkg"
        g.to_file(f, driver="GPKG", layer=f"grid_{label(sz)}")
        log.info("%s: %d cells (%d with centre in AOI) -> %s", label(sz), len(g), g["in_aoi"].sum(), f.name)


if __name__ == "__main__":
    main()
