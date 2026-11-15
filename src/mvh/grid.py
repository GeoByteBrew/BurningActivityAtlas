# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Nested equal-area grids in the global EASE-Grid 2.0 projection (EPSG:6933).

Cells are counted from the projection origin, so ids are globally unique and nest exactly
(25 × 1 km per 5 km cell, `tile_cells`² × 5 km per processing tile). A cell id is one int64
packing the column i and row j; the cell size is not part of the id (it is given by the column
or table the id lives in). `cell_label` gives the readable form "5kmE-123N456".

Integer ids keep a global table (hundreds of millions of rows) small and make cell assignment,
parent lookup and tiling plain arithmetic: no spatial join, no polygon layer.
"""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

_OFF = 1 << 20          # |i|, |j| < 2^20: enough for 20 m cells on EPSG:6933
_SHIFT = 21
_MASK = (1 << _SHIFT) - 1
NO_CELL = -1            # coordinates outside the projection (|lat| > ~84°)


def label(size_m: int) -> str:
    return f"{size_m // 1000}km"


def project(lon: np.ndarray, lat: np.ndarray, crs: str) -> tuple[np.ndarray, np.ndarray]:
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    return tr.transform(np.asarray(lon, float), np.asarray(lat, float))


def cell_index(x: np.ndarray, y: np.ndarray, size_m: int) -> tuple[np.ndarray, np.ndarray]:
    return np.floor(np.asarray(x) / size_m).astype(np.int64), np.floor(np.asarray(y) / size_m).astype(np.int64)


def pack(i: np.ndarray, j: np.ndarray) -> np.ndarray:
    return ((np.asarray(i, np.int64) + _OFF) << _SHIFT) | (np.asarray(j, np.int64) + _OFF)


def unpack(ids) -> tuple[np.ndarray, np.ndarray]:
    ids = np.asarray(ids, np.int64)
    return (ids >> _SHIFT) - _OFF, (ids & _MASK) - _OFF


def cell_label(ids, size_m: int) -> np.ndarray:
    """Readable ids, e.g. 5kmE-123N456 (E = column, N = row from the EPSG:6933 origin)."""
    i, j = unpack(ids)
    return (label(size_m) + "E" + pd.Series(i).astype(str) + "N" + pd.Series(j).astype(str)).to_numpy()


def parent_ids(ids, child_size_m: int, parent_size_m: int) -> np.ndarray:
    """Parent cell id of each child id (exact because all grids share the origin)."""
    assert parent_size_m % child_size_m == 0, "parent size must be a multiple of the cell size"
    k = parent_size_m // child_size_m
    i, j = unpack(ids)
    return pack(np.floor_divide(i, k), np.floor_divide(j, k))


def tile_ids(ids, tile_cells: int) -> np.ndarray:
    """Processing tile of each cell: blocks of tile_cells × tile_cells cells, e.g. 't-3_2'."""
    i, j = unpack(ids)
    ti, tj = np.floor_divide(i, tile_cells), np.floor_divide(j, tile_cells)
    return ("t" + pd.Series(ti).astype(str) + "_" + pd.Series(tj).astype(str)).to_numpy()


def tile_bounds(tile: str, tile_cells: int, size_m: int, crs: str) -> tuple[float, float, float, float]:
    """W, S, E, N of a tile in degrees (clamped to the projection limits)."""
    ti, tj = (int(v) for v in tile[1:].split("_"))
    step = tile_cells * size_m
    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lim_x, lim_y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(180.0, 84.0)
    x0, x1 = max(ti * step, -lim_x), min((ti + 1) * step, lim_x)
    y0, y1 = max(tj * step, -lim_y), min((tj + 1) * step, lim_y)
    w, s = tr.transform(x0, y0)
    e, n = tr.transform(x1, y1)
    return float(w), float(s), float(e), float(n)


def assign_cells(df: pd.DataFrame, crs: str, sizes_m: list[int], keep_xy: bool = False) -> pd.DataFrame:
    """Add one int64 cell id column per grid size: cell_1km, cell_5km, ... (NO_CELL if unprojectable)."""
    df = df.copy()
    x, y = project(df["longitude"].to_numpy(), df["latitude"].to_numpy(), crs)
    ok = np.isfinite(x) & np.isfinite(y)
    if keep_xy:
        df["x"], df["y"] = x, y
    xs, ys = np.where(ok, x, 0.0), np.where(ok, y, 0.0)
    for s in sizes_m:
        i, j = cell_index(xs, ys, s)
        df[f"cell_{label(s)}"] = np.where(ok, pack(i, j), NO_CELL)
    return df


def cell_bounds(ids, size_m: int, crs: str) -> pd.DataFrame:
    """Lon/lat rectangle of each cell (EPSG:6933 is cylindrical, so cells are lon/lat rectangles)."""
    i, j = unpack(ids)
    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    # The grid does not stop exactly at the edge of the projection: the outermost cells (beyond
    # ~84° latitude for coarse cells, or at the antimeridian) reach past it, where the inverse
    # projection is undefined. Clamp cell edges to the projection limits (±180°, ±90°).
    x_lim, y_lim = (float(v) for v in Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(180.0, 90.0))
    x0, x1 = np.clip(i * size_m, -x_lim, x_lim), np.clip((i + 1) * size_m, -x_lim, x_lim)
    y0, y1 = np.clip(j * size_m, -y_lim, y_lim), np.clip((j + 1) * size_m, -y_lim, y_lim)
    w, s = tr.transform(x0, y0)
    e, n = tr.transform(x1, y1)
    w, e = x0 / x_lim * 180.0, x1 / x_lim * 180.0          # cylindrical: longitude is linear in x
    s = np.where(np.isfinite(s), s, np.where(y0 < 0, -90.0, 90.0))
    n = np.where(np.isfinite(n), n, np.where(y1 < 0, -90.0, 90.0))
    return pd.DataFrame({"w": w, "s": s, "e": e, "n": n}).round(5)


def build_grid(aoi: gpd.GeoDataFrame, size_m: int, buffer_m: float = 0.0, parent_size_m: int | None = None) -> gpd.GeoDataFrame:
    """Full (unclipped) square cells intersecting the (buffered) AOI. Regional use only.

    Columns: cell_id, label, i, j, aoi_fraction (share of the cell inside the unbuffered AOI),
    in_aoi (cell centre inside AOI), parent cell id (optional), geometry.
    A global 5 km layer would hold ~20 M polygons: at that scale cells are never materialized;
    their bounds are computed from the ids of non-empty cells (`cell_bounds`).
    """
    aoi_geom = shapely.union_all(aoi.geometry.values)
    search = aoi_geom.buffer(buffer_m) if buffer_m else aoi_geom
    minx, miny, maxx, maxy = search.bounds
    i0, j0 = int(np.floor(minx / size_m)), int(np.floor(miny / size_m))
    i1, j1 = int(np.ceil(maxx / size_m)), int(np.ceil(maxy / size_m))
    ii, jj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1), indexing="ij")
    ii, jj = ii.ravel(), jj.ravel()
    boxes = shapely.box(ii * size_m, jj * size_m, (ii + 1) * size_m, (jj + 1) * size_m)

    shapely.prepare(search)
    keep = shapely.intersects(search, boxes)
    ii, jj, boxes = ii[keep], jj[keep], boxes[keep]

    shapely.prepare(aoi_geom)
    frac = shapely.area(shapely.intersection(boxes, aoi_geom)) / float(size_m * size_m)
    cx, cy = (ii + 0.5) * size_m, (jj + 0.5) * size_m
    in_aoi = shapely.contains_xy(aoi_geom, cx, cy)

    ids = pack(ii, jj)
    gdf = gpd.GeoDataFrame(
        {"cell_id": ids, "label": cell_label(ids, size_m), "i": ii, "j": jj,
         "aoi_fraction": np.round(frac, 4), "in_aoi": in_aoi},
        geometry=boxes, crs=aoi.crs,
    )
    if parent_size_m:
        gdf[f"parent_{label(parent_size_m)}"] = parent_ids(ids, size_m, parent_size_m)
    return gdf
