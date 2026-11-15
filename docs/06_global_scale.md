# 06 · Running on the world

The project targets the whole world: `config/config.yaml`, the default, is the world for 2003–2025.
Two other configurations extend it: `config/world_test_2019.yaml` (the world for one year, a quick first
run) and `config/multi_year.yaml` (the full record written to its own folders: the configuration of the
published run). The code is the same for all three; a smaller `aoi.bbox_wgs84` gives a regional run.

## 1. What changes with scale

| Topic | One region | World | How it is handled |
|---|---|---|---|
| Detections | ~1 M | several hundred million (estimate) | One Parquet file per tile and year; raw CSV read in chunks |
| 5 km cells | 28 000 | ~6 M on land (~20 M with sea) | No polygon layer; integer ids; only non-empty cells exist |
| Cell ids | strings | 64-bit integers | `mvh.grid.pack / unpack / cell_label` |
| Regions | 3 polygons | ~250 countries and territories, grouped by UN sub-region | `mvh.regions.RegionIndex`; super-region level in the hierarchy |
| Overpasses | time gaps over the AOI | time gaps per tile | A platform is always detecting somewhere on the globe |
| Outages | cannot be seen | visible in domain-wide daily counts | `detect_outages` + known file |
| Factor fit | one table in memory | sums per tile | Upper levels from region × month sums, cell levels per tile (same result, tested) |
| Validation | one table | moment sums per tile | `eval_parts` / `eval_finish` (Pearson exact; Spearman on a per-tile sample) |
| Web | one dataset, 20 000 cells | overview + detail windows | `datasets.json`, dataset switcher |

## 2. Layout of the partitioned data

```
data/processed/detections/<tile>/<year>.parquet     flagged detections (+ cell_1km, cell_5km, region)
data/aggregated/daily_5km_Q1/<tile>/<year>.parquet  cell × day × platform (n_det, n_day, frp_sum, frp_day)
                      cells/<tile>.parquet                cell → region, super-region, totals
                      platform_days/<tile>.parquet        detections per day and platform (outage screening)
                      region_month/<tile>.parquet         detections per region, month, platform
data/harmonized/calib_cm/<tile>.parquet             calibration sums per cell × month × predictor × D/N
                      factors_{all,super,region}.csv      upper factor levels
                      factors/<tile>.parquet              cell and cell-month factors (with f_se)
                      daily_5km/<tile>/<year>.parquet     harmonized daily series (source, factor, f_se)
                      monthly_5km/<tile>.parquet          monthly series, median, anomaly
                      monthly_region.parquet, availability.csv, outages_used.csv
```

A tile is a block of `grid.tile_cells` × `grid.tile_cells` cells of 5 km (default 400 → 2000 km), named
`t<column>_<row>` from the EPSG:6933 origin. The world has about 18 × 8 such blocks; those without fire
never appear. Memory is bounded by the busiest tile (central Africa): lower `grid.tile_cells` if it does
not fit, at the price of more files.

## 3. Running the pipeline

The commands are the same for every configuration; `MVH_CONFIG` (or `--config` on each script) selects it.

```bash
export MVH_CONFIG=config/world_test_2019.yaml     # one year; config/multi_year.yaml for the full record

python scripts/00_prepare_aoi.py              # countries + UN sub-regions → data/aoi/world_regions.gpkg
python scripts/03_create_grid.py              # prints the tile layout
python scripts/01_download_data.py            # optional: FIRMS API (needs FIRMS_MAP_KEY in .env)
python scripts/02_quality_control.py --jobs 4 # ingest, cells, flags, country lookup
python scripts/04_aggregate.py --jobs 4       # daily cell counts
python scripts/06_harmonize.py --jobs 4       # factors, validation, series, report
python scripts/07_export_web.py               # world overview (50 km) + detail windows
cd web && npm install && npm run dev          # http://localhost:5173
```

**Input data.** Raw CSV files go to `data/raw/<region>/<SOURCE>/`, with `<SOURCE>` = `MODIS_SP`,
`VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_SP` and `<region>` = `project.region` of the configuration.
Two sources are supported:

- *FIRMS yearly summaries by country* (archive download page): one zip per instrument and year holding one
  CSV per country. Files are read whatever their name or extent, sub-folders included. This is the source
  of the published run. The `type` column must be present: without it static sources (gas flares,
  industry) cannot be excluded.
- *FIRMS API* (`01_download_data.py`): the world is requested in 30° boxes and 5-day chunks, about 13 000
  requests for three sources of one year; the download is resumable. Practical for one year, not for the
  full record.

**One year first** (`config/world_test_2019.yaml`). 2019 is the last year of the MODIS calibration period
and has MODIS, S-NPP and NOAA-20. A one-year run gives world factors by sub-region and by day/night, the
outage screening and a held-out validation inside the year (factors fitted on January–August, scored on
September–December). It cannot show drift after 2019, the independent year or anomalies: the "normal" is
2019 itself, so every ratio to normal is about 1.

**Full record** (`config/multi_year.yaml`, or the default configuration): 2003–2025. Run on 2026-11-15 from
the yearly country files of MODIS and S-NPP; 126 tiles hold data. Results:
[05_version_comparison.md](05_version_comparison.md) §5 and
`outputs/world_multiyear/reports/harmonization_report.md`.

**Re-runs.** Stage 02 skips raw files already ingested, stage 04 skips tiles that are up to date,
`--tiles t3_1,t3_2` restricts 04 and 05 to some tiles, `--force` rebuilds. Stage 06 always recomputes
(factors depend on the whole domain). The report has seven sections: sources and outages, factors,
held-out validation, skill by year, annual series, calendar, checks.

## 4. Web datasets

`web:` in the configuration lists what `07_export_web.py` writes under `web/public/data/`:

- **overview**: the whole domain on coarse cells (`cell_m`, a multiple of 5 km; default 50 km), regions =
  super-regions, no single detections. If the browser struggles (the script warns above
  `web.max_cells`), use 100 km.
- **details**: windows (`bbox`) at 5 km with single detections (capped per year, highest FRP first),
  regions = countries. Four examples are configured (Iberian Peninsula, California, central Africa,
  south-east Australia); each further entry adds a window. A window without data is skipped.

The validation tables shown in every dataset are those of the whole run (`validation_scope` in
`meta.json`); the regional rows are limited to the regions of the dataset.

Stage 07 rewrites `datasets.json` with the datasets of the active configuration. A folder left by an
earlier configuration is no longer listed and can be deleted.

## 5. Open points specific to the world

- **Regions.** Countries are administrative units. Large countries (Russia, Brazil, Canada, Australia)
  mix fire regimes; the cell levels absorb most of it, but GFED basis regions or biomes would be better
  parents (D-19).
- **Static sources.** `type` = 0 only keeps vegetation fires in SP products. Gas-flaring regions
  (Middle East, Siberia, Nigeria) remain to be checked on the world maps.
- **High latitudes.** Overlapping swaths give several overpasses per day; the ratio absorbs the mean
  effect per cell, but the day/night flag near the terminator in summer deserves a look.
- **UTC days.** See [01_methodology.md](01_methodology.md) §5.
- **Outage screening** only sees whole days. The 24 intervals found in the published run remain to be
  compared with the FIRMS mission anomaly notes.
