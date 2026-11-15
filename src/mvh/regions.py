"""Statistical regions: point → region lookup that scales from 3 polygons to every country.

A region file has one polygon per row with `name` and (optionally) `parent`, the super-region
used as an extra level of the factor hierarchy (UN sub-region in the global configuration).
"""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import shapely


class RegionIndex:
    def __init__(self, regions: gpd.GeoDataFrame, snap_deg: float = 0.0):
        r = regions.to_crs("EPSG:4326").reset_index(drop=True)
        self.names = [str(n) for n in r["name"]] if "name" in r else ["aoi"] * len(r)
        par = r["parent"] if "parent" in r else None
        self.parents = [str(p) if p is not None and p == p else "all" for p in par] if par is not None else ["all"] * len(r)
        self.geoms = np.asarray(r.geometry.values)
        for g in self.geoms:
            shapely.prepare(g)
        self.bounds = shapely.bounds(self.geoms)
        self.snap_deg = snap_deg
        self._tree = shapely.STRtree(self.geoms) if snap_deg > 0 else None

    @property
    def parent_of(self) -> dict[str, str]:
        return dict(zip(self.names, self.parents))

    def codes(self, lon, lat) -> np.ndarray:
        """Index into `names` for every point, -1 outside every region."""
        lon, lat = np.asarray(lon, float), np.asarray(lat, float)
        out = np.full(len(lon), -1, dtype=np.int32)
        ok = np.isfinite(lon) & np.isfinite(lat)
        if not ok.any():
            return out
        w, s, e, n = lon[ok].min(), lat[ok].min(), lon[ok].max(), lat[ok].max()
        b = self.bounds
        cand = np.flatnonzero((b[:, 0] <= e) & (b[:, 2] >= w) & (b[:, 1] <= n) & (b[:, 3] >= s))
        for k in cand:  # prepared polygon × vectorized points; first match wins (regions are disjoint)
            todo = np.flatnonzero(ok & (out < 0) & (lon >= b[k, 0]) & (lon <= b[k, 2]) & (lat >= b[k, 1]) & (lat <= b[k, 3]))
            if len(todo):
                hit = shapely.contains_xy(self.geoms[k], lon[todo], lat[todo])
                out[todo[hit]] = k
        if self._tree is not None:
            miss = np.flatnonzero(ok & (out < 0))
            if len(miss):  # coast lines / small islands: nearest region within snap_deg
                pi, gi = self._tree.query_nearest(shapely.points(lon[miss], lat[miss]),
                                                  max_distance=self.snap_deg, all_matches=False)
                out[miss[pi]] = gi
        return out

    def lookup(self, lon, lat) -> np.ndarray:
        """Region name per point (None outside every region)."""
        c = self.codes(lon, lat)
        names = np.array(self.names + [None], dtype=object)
        return names[c]
