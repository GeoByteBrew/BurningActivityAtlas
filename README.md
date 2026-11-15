# Burning Activity Atlas · global MODIS–VIIRS harmonization

Builds a **comparable fire activity record for the whole world** from NASA FIRMS MODIS and VIIRS active
fire detections, on a global equal-area grid (EPSG:6933, 1 km + 5 km), and a **Burning Activity Calendar**
on top of it.

The default configuration (`config/config.yaml`) is the world, 2003–2025. Every stage works tile by tile
on partitioned files, so the same code also runs on one year (`config/world_test_2019.yaml`, the first run
to do) or on one region (`config/iberia.yaml`).

Core principle: sensors are never pooled. The record is VIIRS S-NPP when it works; otherwise one stand-in
(NOAA-20, NOAA-21, then MODIS) converted with a factor measured on days when both worked.

## Documents

| File | Contents |
|---|---|
| [docs/01_methodology.md](docs/01_methodology.md) | Method: QC → grid → time → availability → factors → calendar, validation, limits |
| [docs/02_data_sources.md](docs/02_data_sources.md) | FIRMS products, fields, access paths, external data |
| [docs/03_roadmap.md](docs/03_roadmap.md) | Plan and progress |
| [docs/04_decision_log.md](docs/04_decision_log.md) | Methodological decisions and their rationale |
| [docs/05_version_comparison.md](docs/05_version_comparison.md) | Current method compared with the earlier versions; which results belong to which version |
| [docs/06_global_scale.md](docs/06_global_scale.md) | **Running on the world**: partitions, commands, web datasets, open points |
| [docs/07_nasa_submission.md](docs/07_nasa_submission.md) | Short NASA Space Apps blurb (results + limits) |
| [outputs/world_multiyear/reports/harmonization_report.md](outputs/world_multiyear/reports/harmonization_report.md) | World run validation report |

## Setup

```bash
cd nasa_burning_activity                  # your clone of the repository
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                          # fill in FIRMS_MAP_KEY
```

FIRMS MAP_KEY (free): <https://firms.modaps.eosdis.nasa.gov/api/map_key/>

## Pipeline order

```bash
# Choose the run (default = world, full record):
export MVH_CONFIG=config/world_test_2019.yaml     # first run: the world for one year
# export MVH_CONFIG=config/iberia.yaml            # one region

.venv/bin/python scripts/00_prepare_aoi.py        # regions: countries + UN sub-regions
.venv/bin/python scripts/03_create_grid.py        # prints the tile layout (world: nothing is materialized)
.venv/bin/python scripts/01_download_data.py --check   # MAP_KEY + product availability
.venv/bin/python scripts/01_download_data.py      # FIRMS API → data/raw/<region>/<SOURCE>/ (resumable)
.venv/bin/python scripts/02_quality_control.py    # schema, cells, QC flags, region → detections/<tile>/<year>
.venv/bin/python scripts/04_aggregate.py          # overpasses, daily cell counts (day/night)
.venv/bin/python scripts/06_harmonize.py          # availability, factors, validation, series, calendar, report
.venv/bin/python scripts/07_export_web.py         # web datasets → web/public/data/<dataset>/
.venv/bin/python scripts/05_explore_report.py     # optional: data exploration on the busiest tiles
.venv/bin/python -m pytest -q tests               # unit tests + synthetic end-to-end run (~1.5 min)
```

Stages 02, 04, 06 take `--jobs N`; 02 only ingests new raw files, 04 only rebuilds tiles that changed.
Step-by-step instructions for the first world run, including how to get the data:
[docs/06_global_scale.md](docs/06_global_scale.md).

What stage 06 does, in short:

- **Availability**: operational periods minus known outages (`data/ancillary/outages.csv`) minus outages
  found in domain-wide daily counts (world run).
- **Factors**: Σ VIIRS / Σ predictor per predictor and day/night half, shrunk along
  all → super-region → region → 5 km cell → cell-month (K = 50). MODIS is calibrated on 2012–2019,
  NOAA-20/21 on their overlap with S-NPP.
- **Validation**: held-out months, yearly drift check, independent year; split vs pooled day/night factors;
  region × month table of the largest departures.
- **Uncertainty**: bootstrap interval for regional factors, `f_se` and held-out dispersion for local ones.

## Web app (Burning Activity Atlas)

CesiumJS + React dashboard. The default view is the harmonized series; in "Ratio to normal" mode red on the
map and in the calendar means more detections than usual for the baseline years, blue means fewer.

- **View** (top right): the world on coarse cells (50 km), or a regional window at 5 km with single
  detections. `?dataset=<id>` opens one directly. Windows are listed under `web.details` in the configuration.
- Timeline: a year, a month, or a range with shift-click; ←/→ shifts the range, Space plays. Years are
  marked as MODIS backcast, calibration, drift check or test.
- Compare sensors: raw MODIS, raw VIIRS, their raw gap, and converted MODIS − real VIIRS.
- Method: conversion factor with 90% interval, converted / VIIRS ratio by year, day/night factors, outages
  and the cell-scale limitation.
- Download: regional monthly series CSV, cell CSV, charts PNG, map PNG.

At regional level "normal" = median of the baseline years (2012–2024). In a single cell the median is
mostly 0, so the baseline mean is used with a ratio damped for small counts: `(n + 2) / (normal + 2)`.
Years before 2012 are MODIS converted to the VIIRS scale, not VIIRS observations.

```bash
.venv/bin/python scripts/07_export_web.py   # → web/public/data/<dataset>/*.json and datasets.json
cd web && npm install && npm run dev        # http://localhost:5173
npm run build                               # static site → web/dist/ (runs on any static host)
```

The datasets in `web/public/data/` come from the world run of 2026-11-15: the world overview on 50 km
cells and the regional windows listed under `web.details` in the configuration.

## Folder structure

```
config/config.yaml            the world, full record (default)
config/world_test_2019.yaml   the world for one year (first run)
config/iberia.yaml            a regional run
src/mvh/                library: firms, qc, grid (ids, tiles), regions, store (partitions), temporal, harmonize
scripts/                numbered pipeline steps
data/raw/<region>/<SOURCE>/         raw FIRMS CSV (never modified; sub-folders allowed)
data/processed/detections/<tile>/   standardized + QC-flagged Parquet, one file per year
data/aggregated/        cell-day-platform counts, overpasses, cell → region tables (per tile)
data/harmonized/        availability, factors, harmonized daily/monthly series (per tile)
data/ancillary/         outages.csv (known outages: platform,start,end,note)
outputs/                reports, CSV tables, figures
tests/                  unit tests, synthetic archive generator (synth.py), end-to-end test
web/                    Burning Activity Atlas (CesiumJS + React)
```

The one-year and regional configurations write to their own folders (`data/world_2019/`, `data/iberia/`,
`outputs/...`), so runs do not overwrite each other.

## Status (2026-11-15)

**First world run done**: 2003–2025, MODIS (Terra, Aqua) and VIIRS S-NPP, 126 tiles, 233 countries.
Full table and discussion: [docs/05_version_comparison.md](docs/05_version_comparison.md) §5.
Machine report, figures and CSV: [outputs/world_multiyear/reports/harmonization_report.md](outputs/world_multiyear/reports/harmonization_report.md).
Short NASA blurb: [docs/07_nasa_submission.md](docs/07_nasa_submission.md).

Live web datasets (Justine’s export): **World**, Iberia, California, Central Africa, South-east Australia.

| Result | Value |
|---|---|
| Terra+Aqua → VIIRS factor (2012–2019) | 4.05 (90%: 4.01–4.10); day 3.48, night 8.87 |
| Held-out months: raw MODIS / VIIRS → converted / VIIRS | 0.24 → 0.98 |
| Region × month correlation with VIIRS (held-out) | 1.00 |
| Converted / VIIRS by year after calibration (2020–2025) | 0.94–1.01 |
| VIIRS cell-months where MODIS saw nothing | 54% |
| Outages found and excluded | 24 |

Known limits of this run:

- Converted totals are about 5% low inside the calibration years (0.93–0.97), so the MODIS-only years
  2003–2011 are probably about 5% low relative to the VIIRS years. A correction is identified, not applied.
- Single cells stay uncertain: the cell-month error barely improves (4.51 → 4.39).
- Eastern Asia is converted too low (0.76); volcanic eruptions (Iceland 2021) and some industrial sources
  are not classified the same way by the two products and give wrong local values.
- NOAA-20 and NOAA-21 were not downloaded: the backup platforms are tested on synthetic data only.
- No external validation yet (burned area, known fires).

Tests: 25 passed, including an end-to-end run on a synthetic archive with known ratios.
