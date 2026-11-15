# AI disclosure: written or revised with a large language model (Claude, Anthropic). See AI_USE.md.
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from mvh import grid, qc, temporal  # noqa: E402
from mvh.config import load_config  # noqa: E402
from mvh.firms import date_chunks  # noqa: E402


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def raw_modis():
    return pd.DataFrame({
        "latitude": [43.6, 43.6, 43.61, 95.0, 43.7],
        "longitude": [3.9, 3.9, 3.9, 3.9, 3.95],
        "brightness": [320.0] * 5, "scan": [1.0, 1.0, 1.0, 1.0, 2.5], "track": [1.0, 1.0, 1.0, 1.0, 1.4],
        "acq_date": ["2019-07-10", "2019-07-10", "2019-07-10", "2019-07-10", "2019-07-10"],
        "acq_time": ["1305", "1305", "1305", "1305", "105"],
        "satellite": ["Aqua", "Aqua", "Aqua", "Terra", "A"], "confidence": ["85", "85", "20", "50", "60"],
        "version": ["6.1"] * 5, "bright_t31": [300.0] * 5, "frp": [10.0, 10.0, 3.0, 5.0, 7.0],
        "daynight": ["D", "D", "D", "D", "N"], "type": [0, 0, 0, 0, 2],
    })


def raw_viirs():
    return pd.DataFrame({
        "latitude": [43.6001, 43.6005], "longitude": [3.9001, 3.9004],
        "bright_ti4": [340.0, 330.0], "scan": [0.4, 0.4], "track": [0.4, 0.4],
        "acq_date": ["2019-07-10"] * 2, "acq_time": ["1300", "1301"], "satellite": ["N", "N"],
        "confidence": ["h", "l"], "version": ["2"] * 2, "bright_ti5": [295.0] * 2, "frp": [4.0, 2.0],
        "daynight": ["D", "D"], "type": [0, 0],
    })


def standardized(cfg):
    m = qc.standardize(raw_modis(), cfg["firms"]["sources"][0], cfg["qc"])
    v = qc.standardize(raw_viirs(), cfg["firms"]["sources"][1], cfg["qc"])
    return qc.add_qc_flags(pd.concat([m, v], ignore_index=True), cfg)


def test_standardize_and_flags(cfg):
    df = standardized(cfg)
    assert set(df["platform"]) == {"Aqua", "Terra", "S-NPP"}
    assert df.loc[4, "acq_datetime"] == pd.Timestamp("2019-07-10 01:05", tz="UTC")
    assert df.loc[1, "f_duplicate"] and not df.loc[0, "f_duplicate"]
    assert not df.loc[3, "f_coord_ok"]          # lat 95
    assert not df.loc[4, "f_type_ok"]           # static source
    assert df["f_base_ok"].tolist() == [True, False, True, False, False, True, True]
    # Q1: MODIS conf>=30, VIIRS n/h ; Q3: everything that passed base QC
    assert df["q_Q1"].tolist() == [True, False, False, False, False, True, False]
    assert df["q_Q2"].tolist() == [True, False, False, False, False, True, False]
    assert df["q_Q3"].sum() == df["f_base_ok"].sum()
    assert df.loc[0, "conf_class"] == "h" and df.loc[2, "conf_class"] == "l"


def test_cells_nest(cfg):
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"longitude": rng.uniform(0, 4.5, 2000), "latitude": rng.uniform(42.5, 45, 2000)})
    g = grid.assign_cells(df, "EPSG:6933", [1000, 5000], keep_xy=True)
    i1 = np.floor(g["x"] / 1000).astype(int)
    j1 = np.floor(g["y"] / 1000).astype(int)
    assert (g["cell_5km"] == grid.pack(i1 // 5, j1 // 5)).all()
    assert (grid.parent_ids(g["cell_1km"], 1000, 5000) == g["cell_5km"]).all()
    assert pd.Series(grid.cell_label(g["cell_1km"], 1000)).str.match(r"^1kmE-?\d+N-?\d+$").all()


def test_build_grid_full_cells():
    aoi = gpd.GeoDataFrame(geometry=[box(3_600_500, 2_300_200, 3_610_300, 2_305_900)], crs="EPSG:6933")
    g1 = grid.build_grid(aoi, 1000, parent_size_m=5000)
    g5 = grid.build_grid(aoi, 5000)
    assert np.allclose(g1.area, 1e6)                       # full, unclipped cells
    assert set(g1["parent_5km"]) <= set(g5["cell_id"])
    assert g1.groupby("parent_5km").size().max() <= 25
    assert abs((g1["aoi_fraction"] * 1e6).sum() - aoi.area.iat[0]) < 1


def test_overpass_and_matching(cfg):
    df = standardized(cfg)
    df = df[df["f_base_ok"]]
    df = grid.assign_cells(df, "EPSG:6933", [1000, 5000])
    df = temporal.assign_overpasses(df, 20)
    ov = temporal.overpass_table(df)
    assert set(ov["platform"]) == {"Aqua", "S-NPP"}
    pairs = temporal.match_overpasses(ov, "Aqua", "S-NPP", 5)
    assert len(pairs) == 1 and abs(pairs["dt_min"].iat[0]) <= 5
    m = temporal.matched_cell_counts(df, pairs, "cell_5km")
    assert (m["n_a"] > 0).any() and (m["n_b"] > 0).any()
    d = temporal.daily_counts(df, "cell_1km", "q_Q3")
    assert d["n_det"].sum() == len(df)


def test_date_chunks():
    from datetime import date
    ch = list(date_chunks(date(2020, 1, 1), date(2020, 1, 12), 5))
    assert ch == [(date(2020, 1, 1), 5), (date(2020, 1, 6), 5), (date(2020, 1, 11), 2)]


def test_region_index_lookup_and_snap():
    from mvh.regions import RegionIndex
    reg = gpd.GeoDataFrame({"name": ["West", "East"], "parent": ["P", "Q"]},
                           geometry=[box(0, 0, 1, 1), box(1, 0, 2, 1)], crs="EPSG:4326")
    lon, lat = np.array([0.5, 1.5, 2.05, 5.0, np.nan]), np.array([0.5, 0.5, 0.5, 0.5, 0.5])
    assert RegionIndex(reg).lookup(lon, lat).tolist() == ["West", "East", None, None, None]
    snap = RegionIndex(reg, snap_deg=0.1)
    assert snap.lookup(lon, lat).tolist() == ["West", "East", "East", None, None]
    assert snap.parent_of == {"West": "P", "East": "Q"}


def test_tiles_nest_cells_and_cover_globe(cfg):
    crs = cfg["crs"]["equal_area"]
    rng = np.random.default_rng(1)
    df = pd.DataFrame({"longitude": rng.uniform(-180, 180, 5000), "latitude": rng.uniform(-60, 75, 5000)})
    g = grid.assign_cells(df, crs, [1000, 5000])
    assert (g["cell_5km"] >= 0).all() and g["cell_1km"].nunique() > 4900
    t5 = grid.tile_ids(g["cell_5km"], 400)
    assert (grid.tile_ids(grid.parent_ids(g["cell_1km"], 1000, 5000), 400) == t5).all()
    # every point lies inside the lon/lat bounds of its tile and of its cell
    for t in pd.unique(t5)[:40]:
        w, s, e, n = grid.tile_bounds(t, 400, 5000, crs)
        sub = df[t5 == t]
        assert sub["longitude"].between(w - 1e-6, e + 1e-6).all() and sub["latitude"].between(s - 1e-6, n + 1e-6).all()
    b = grid.cell_bounds(g["cell_5km"], 5000, crs)
    assert (b["w"].to_numpy() <= df["longitude"] + 1e-5).all() and (df["latitude"] <= b["n"].to_numpy() + 1e-5).all()
    # unusable coordinates are flagged with NO_CELL, never crash the stage
    bad = grid.assign_cells(pd.DataFrame({"longitude": [0.0], "latitude": [np.nan]}), crs, [5000])
    assert bad["cell_5km"].iat[0] == grid.NO_CELL


def test_download_boxes():
    import importlib.util
    spec = importlib.util.spec_from_file_location("dl", Path(__file__).resolve().parents[1] / "scripts" / "01_download_data.py")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    dl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dl)
    assert dl.request_boxes([-10, 35, 5, 45], None) == [("", [-10, 35, 5, 45])]
    world = dl.request_boxes([-180, -60, 180, 84], 30)
    assert len(world) == 12 * 5 and world[0] == ("W180S60", [-180, -60, -150, -30])
    assert len({t for t, _ in world}) == len(world)
    assert abs(sum((b[2] - b[0]) * (b[3] - b[1]) for _, b in world) - 360 * 144) < 1e-6


def test_cell_bounds_defined_at_projection_edges(cfg):
    """Coarse cells reaching past the pole or the antimeridian still get finite lon/lat bounds."""
    crs = cfg["crs"]["equal_area"]
    df = pd.DataFrame({"longitude": [0.0, 179.99, -179.99, 0.0, 10.0], "latitude": [-89.5, -16.8, 66.0, 83.95, 45.0]})
    c5 = grid.assign_cells(df, crs, [5000])["cell_5km"]
    for size in (5000, 50000, 100000):
        ids = c5 if size == 5000 else grid.parent_ids(c5, 5000, size)
        b = grid.cell_bounds(ids, size, crs)
        assert np.isfinite(b.to_numpy()).all()
        assert (b["s"] < b["n"]).all() and (b["w"] < b["e"]).all()
        assert b["w"].min() >= -180 and b["e"].max() <= 180 and b["s"].min() >= -90 and b["n"].max() <= 90
        assert ((b["w"] <= df["longitude"] + 1e-5) & (df["longitude"] <= b["e"] + 1e-5)).all()
        assert ((b["s"] <= df["latitude"] + 1e-5) & (df["latitude"] <= b["n"] + 1e-5)).all()


def test_global_run_flags_detections_outside_the_domain(cfg):
    df = standardized(cfg)
    world = {**cfg, "aoi": {**cfg["aoi"], "bbox_wgs84": [-180.0, -60.0, 180.0, 84.0]}}
    df.loc[df.index[0], "latitude"] = -75.0                      # Antarctica
    out = qc.add_qc_flags(df.drop(columns=[c for c in df if c.startswith(("f_", "q_")) or c == "region"]), world,
                          aoi_region=lambda lon, lat: np.full(len(lon), None, dtype=object), clip=False)
    # row 0 moved to Antarctica, row 3 has an invalid latitude (95°): both outside the domain
    assert out["f_in_aoi"].tolist() == [False, True, True, False, True, True, True]
    assert not out["f_base_ok"].iat[0]
