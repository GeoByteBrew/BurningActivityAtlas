# 07 · NASA Space Apps — short submission text

Status: 2026-11-15. Live app: the Burning Activity Atlas on this repository (`web/`). Full method:
[01_methodology.md](01_methodology.md). World validation report:
[../outputs/world_multiyear/reports/harmonization_report.md](../outputs/world_multiyear/reports/harmonization_report.md).

## One sentence

A global, VIIRS-equivalent fire **detection** record for 2003–2025 that turns MODIS into the same scale as
Suomi NPP VIIRS, with a CesiumJS atlas, a Burning Activity Calendar, and a browser-side “analyze your area”
tool.

## What we built

1. **Pipeline (Python)** — FIRMS download → QC flags (nothing deleted) → global EASE-Grid 2.0 cells (5 km) →
   hierarchical day/night conversion factors → harmonized monthly series and validation tables.
2. **Burning Activity Atlas (web)** — World overview (50 km) plus detail windows (Iberia, California,
   Central Africa, South-east Australia) at 5 km with single detections; ratio-to-normal map and calendar;
   sensor comparison; CSV / chart / map download; mobile layout.
3. **Your area** — Upload GeoJSON, KML or a zipped Shapefile, or draw a polygon; the atlas returns the
   harmonized time series, ratio to normal and CSVs for that boundary (no server upload).

## World result (first real global run)

| Indicator | Value |
|---|---|
| Terra+Aqua → VIIRS factor (2012–2019) | **4.05** (90% CI 4.01–4.10) |
| Held-out months: raw MODIS/VIIRS → converted/VIIRS | **0.24 → 0.98** |
| Region × month correlation with VIIRS | **1.00** |
| Converted / VIIRS by year, 2020–2025 | **0.94–1.01** |
| Outages detected and excluded | 24 |

Config: `config/multi_year.yaml` (MODIS Terra+Aqua + VIIRS S-NPP). Factors agree with the earlier Pix’Elles
prototype (~4.05 vs 4.14–4.28 for Terra+Aqua).

## Limits we announce (not hidden)

- Converted totals are **~5% low** inside the calibration years (0.93–0.97), so MODIS-only years 2003–2011
  are probably ~5% low relative to VIIRS years. A total-preserving correction is identified, not applied yet.
- Cell-level error barely improves (MAE ~4.5 → ~4.4): the product is for **regional / monthly / yearly**
  totals, not single 5 km cells.
- Eastern Asia converts too low (~0.76); some volcanoes and industrial sources disagree between products
  (e.g. Iceland 2021).
- NOAA-20 / NOAA-21 were **not** downloaded and are **not** in the published config; the series uses S-NPP,
  else MODIS × factor. NOAA backup support is code-ready / synthetic-tested only.
- No external burned-area validation yet (EFFIS, MCD64A1).

## Data & reproducibility

- Code and web datasets: this GitHub repository (`main`).
- Validation tables and figures: `outputs/world_multiyear/`.
- Web snapshot archive: GitHub Release `data-v1`.
- Raw FIRMS downloads: too large for git; intended for a later Zenodo deposit.

## How to try it

Open the live atlas → pick **World** or a regional window → set the timeline → open **About** / **Method**
for the evidence → use **Your area** for a project boundary.

---

*AI use: this text was drafted with the assistance of an AI tool (large language model). See [AI_USE.md](../AI_USE.md).*
