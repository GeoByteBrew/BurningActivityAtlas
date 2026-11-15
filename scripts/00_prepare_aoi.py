# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
"""Build the region layer (one polygon per region, columns `name`, `parent`).

Region = every Natural Earth country intersecting aoi.bbox_wgs84; parent = its UN sub-region,
used as the super-region level of the factors. A smaller bbox gives a regional run.
"""
import _bootstrap  # noqa: F401

import geopandas as gpd
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

    ne = fetch(a["natural_earth_url"], ne_file)
    ne = ne[~ne["ADMIN"].isin(a.get("exclude", []))]
    aoi = gpd.GeoDataFrame({"name": ne["ADMIN"].to_numpy(), "parent": ne["SUBREGION"].to_numpy(),
                            "iso_a3": ne["ADM0_A3"].to_numpy()},
                           geometry=ne.geometry.intersection(clip).to_numpy(), crs="EPSG:4326")
    aoi = aoi[~aoi.geometry.is_empty].reset_index(drop=True)
    if a.get("simplify_deg"):
        aoi["geometry"] = aoi.geometry.simplify(a["simplify_deg"], preserve_topology=True)

    out = ROOT / a["file"]
    out.parent.mkdir(parents=True, exist_ok=True)
    aoi.to_file(out, driver="GPKG" if out.suffix == ".gpkg" else "GeoJSON")
    ea = aoi.to_crs(cfg["crs"]["equal_area"])
    log.info("%d regions in %d super-regions, %.0f km² (CRS %s) -> %s", len(aoi), aoi["parent"].nunique(),
             ea.area.sum() / 1e6, cfg["crs"]["equal_area"], out.name)

    w, s, e, n = aoi.total_bounds
    bw, bs, be, bn = a["bbox_wgs84"]
    if not (bw <= w + 1e-9 and bs <= s + 1e-9 and be >= e - 1e-9 and bn >= n - 1e-9):
        log.warning("config bbox_wgs84 does NOT fully cover the AOI — enlarge it before downloading")


if __name__ == "__main__":
    main()
