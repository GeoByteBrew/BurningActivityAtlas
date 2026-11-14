"""Build the region layer (one polygon per region, columns `name`, `parent`).

aoi.mode = countries  every Natural Earth country intersecting aoi.bbox_wgs84 (world, default);
                      parent = UN sub-region, used as the super-region level of the factors
aoi.mode = parts      the sub-regions listed in the config (regional run); parent = the AOI name
"""
import _bootstrap  # noqa: F401

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box

from mvh.config import ROOT, cli, load_config, path, setup_logging

log = setup_logging("00_aoi")


def fetch(url: str, dest):
    if not dest.exists():
        log.info("downloading %s", url)
        r = requests.get(url, timeout=180)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return gpd.read_file(dest).to_crs("EPSG:4326")


def main():
    cfg = load_config(cli(__doc__).parse_args().config)
    a = cfg["aoi"]
    aoi_dir = path(cfg, "aoi")
    clip = box(*a["bbox_wgs84"])
    ne_file = aoi_dir / "ne_10m_admin_0_countries.geojson"

    if a.get("mode", "parts") == "countries":
        ne = fetch(a["natural_earth_url"], ne_file)
        ne = ne[~ne["ADMIN"].isin(a.get("exclude", []))]
        aoi = gpd.GeoDataFrame({"name": ne["ADMIN"].to_numpy(), "parent": ne["SUBREGION"].to_numpy(),
                                "iso_a3": ne["ADM0_A3"].to_numpy()},
                               geometry=ne.geometry.intersection(clip).to_numpy(), crs="EPSG:4326")
        aoi = aoi[~aoi.geometry.is_empty].reset_index(drop=True)
        if a.get("simplify_deg"):
            aoi["geometry"] = aoi.geometry.simplify(a["simplify_deg"], preserve_topology=True)
    else:
        ne = None
        parts = []
        for p in a["parts"]:
            if p["source"] == "natural_earth":
                if ne is None:
                    ne = fetch(a["natural_earth_url"], ne_file)
                g = ne[ne["ADM0_A3"] == p["iso_a3"]]
            else:
                g = fetch(p["url"], aoi_dir / f"{p['name'].lower()}_src.geojson")
            parts.append({"name": p["name"], "parent": p.get("parent", a["name"]),
                          "geometry": g.geometry.union_all().intersection(clip)})
        aoi = gpd.GeoDataFrame(pd.DataFrame(parts), crs="EPSG:4326")
        # Make sub-regions disjoint (borders from different sources overlap slightly)
        for k in range(1, len(aoi)):
            prev = aoi.geometry.iloc[:k].union_all()
            aoi.loc[aoi.index[k], "geometry"] = aoi.geometry.iloc[k].difference(prev)

    out = ROOT / a["file"]
    out.parent.mkdir(parents=True, exist_ok=True)
    aoi.to_file(out, driver="GPKG" if out.suffix == ".gpkg" else "GeoJSON")
    ea = aoi.to_crs(cfg["crs"]["equal_area"])
    if a.get("mode", "parts") != "countries":
        ea.to_file(aoi_dir / "aoi_equal_area.gpkg", driver="GPKG")
        for n, area in zip(ea["name"], ea.area):
            log.info("%-10s %9.0f km²", n, area / 1e6)
    log.info("%d regions in %d super-regions, %.0f km² (CRS %s) -> %s", len(aoi), aoi["parent"].nunique(),
             ea.area.sum() / 1e6, cfg["crs"]["equal_area"], out.name)

    w, s, e, n = aoi.total_bounds
    bw, bs, be, bn = a["bbox_wgs84"]
    if not (bw <= w + 1e-9 and bs <= s + 1e-9 and be >= e - 1e-9 and bn >= n - 1e-9):
        log.warning("config bbox_wgs84 does NOT fully cover the AOI — enlarge it before downloading")


if __name__ == "__main__":
    main()
