# 02 · Data sources

## 1. FIRMS products (active fire points)

| FIRMS source | Sensor / platform | Product | Pixel | Start (approx.) | Used in published world run |
|---|---|---|---|---|---|
| `MODIS_SP` / `MODIS_NRT` | MODIS Terra + Aqua | MCD14ML C6.1 | 1 km (nadir) | Terra 2000-11, Aqua 2002-07 | **Yes** (SP archives, 2003–2025) |
| `VIIRS_SNPP_SP` / `_NRT` | VIIRS S-NPP | VNP14IMG | 375 m | 2012-01 | **Yes** (SP archives, 2012–2025) |
| `VIIRS_NOAA20_SP` / `_NRT` | VIIRS NOAA-20 (JPSS-1) | VJ114IMG | 375 m | 2018-01 (FIRMS) | **No** — catalogued / code-ready only |
| `VIIRS_NOAA21_SP` / `_NRT` | VIIRS NOAA-21 (JPSS-2) | VJ214IMG | 375 m | 2024-01 (FIRMS) | **No** — catalogued / code-ready only |

Dates are approximate. For API users the exact range can be read from the FIRMS `data_availability`
endpoint (`scripts/01_download_data.py --check`). For sources without an SP version the NRT fallback is
used and kept apart in QC through the `source` field.

**Access paths**
- **Archive download (used for the published world run):** firms.modaps.eosdis.nasa.gov/download, yearly
  country files per instrument. Place CSVs under `data/raw/<region>/<SOURCE>/`; the QC step routes every
  row to its tile. Archive files must carry the `type` column (SP products): without it static sources
  cannot be excluded and `f_type_known` is false. Checklist: [data_manifest.md](data_manifest.md).
- **API (optional, not used for the published run):** `/api/area/csv/{MAP_KEY}/{SOURCE}/{W,S,E,N}/{DAY_RANGE}/{DATE}`.
  One request covers at most 5 days; at most 5000 transactions per 10 minutes. A region the size of the
  Iberian Peninsula needs about 1000 requests per source for 2012–2025. With `firms.tile_deg` the box is
  cut into tiles; the download is resumable. The API route for the whole world means hundreds of thousands
  of requests; prefer archives for the full record.

## 2. Fields and standard schema

| Standard field | MODIS source | VIIRS source | Note |
|---|---|---|---|
| `latitude`, `longitude` | same | same | Pixel centre |
| `acq_datetime` | `acq_date` + `acq_time` | same | UTC, HHMM |
| `platform` | `satellite` (Terra/Aqua, T/A) | from source name | |
| `bt_fire` | `brightness` (band 21/22, K) | `bright_ti4` (I4, K) | Not directly comparable |
| `bt_bg` | `bright_t31` | `bright_ti5` | |
| `scan`, `track` | km | km | Pixel size; proxy for scan angle |
| `frp` | MW | MW | VIIRS 375 m FRP is computed from the M13 (750 m) band |
| `conf_num` / `conf_class` | 0–100 / derived l,n,h | — / l,n,h | Scales are not equivalent |
| `type` | 0–3 | 0–3 | Only present in SP products |
| `daynight` | D/N | D/N | |

## 3. VIIRS 750 m M-band (Phase 2)

FIRMS does **not** distribute the 750 m product. The source is LAADS DAAC (https://ladsweb.modaps.eosdis.nasa.gov):
- `VNP14` (S-NPP), `VJ114` (NOAA-20), `VJ214` (NOAA-21): 6-minute granules, NetCDF4. They contain fire pixel
  tables (`FP_latitude`, `FP_longitude`, `FP_power`, `FP_confidence`...) and the `fire mask`.
- Access requires an Earthdata Login token. AOI and date filters are applied with the LAADS API or
  `earthaccess`.
- Use: continuity with MODIS (similar algorithm and pixel scale) and FRP comparison.

## 4. Observation opportunity and true zeros

| Data | Source | Use |
|---|---|---|
| MOD14 / MYD14 (L2, 5 min granules) | LAADS | MODIS `fire mask`: cloud, water, cloud-free land |
| VNP14IMG / VJ114IMG / VJ214IMG (L2) | LAADS | VIIRS 375 m `fire mask` |
| MOD03 / VNP03 | LAADS | Geolocation and view zenith angle (VZA) |
| TLE / orbital elements | CelesTrak / Space-Track | Pilot overpass schedule (Skyfield) |

## 5. External validation

| Data | Use |
|---|---|
| MCD64A1 (500 m burned area) | Relation between activity and burned area |
| EFFIS burned area polygons | European fires above 30 ha |
| BDIFF (French national fire database) | Event counts and area per département and year |

## 6. Regions

Default (world, `config/config.yaml`): every Natural Earth country, with its UN sub-region as super-region
(`data/aoi/world_regions.gpkg`, built by `scripts/00_prepare_aoi.py`).

Country borders: Natural Earth 1:10m admin-0 (public domain), stored in `data/aoi/`.
