# 03 · Roadmap

Status date: 2026-11-14. Method: [01_methodology.md](01_methodology.md) · Decisions: [04_decision_log.md](04_decision_log.md) ·
Versions: [05_version_comparison.md](05_version_comparison.md)

## Done

**Pipeline**
- [x] FIRMS download client (API, resumable) and ingest of archive files of any extent
- [x] Standard schema and QC flags, three confidence scenarios (nothing deleted)
- [x] Global equal-area grid (EPSG:6933), 1 km and 5 km, integer cell ids, processing tiles
- [x] Overpass identification and Aqua–S-NPP matching (diagnostic), daily cell counts with day/night split
- [x] Regions: countries with UN sub-regions as super-regions (or hand-made sub-regions for a regional run)

**Harmonization**
- [x] Availability calendar: known outages file + screening of domain-wide daily counts
- [x] Hierarchical ratio factors on the VIIRS-equivalent scale, by predictor and by day/night
- [x] NOAA-20 / NOAA-21 as backup of S-NPP; MODIS backcast to 2003
- [x] Validation: held-out months, yearly drift check, independent year, split vs pooled day/night
- [x] Uncertainty: bootstrap intervals for regional factors, standard error and dispersion for local ones
- [x] Monthly calendar, historical median (zeros included), anomaly

**Web app**
- [x] CesiumJS app: grid and detection layers, calendar, charts, CSV/PNG download, method panel
- [x] Datasets: world overview and regional windows; raw gap and after-conversion comparison layers

**Runs and tests**
- [x] Regional run on real data, Iberian Peninsula + Occitanie (`config/iberia.yaml`)
- [x] Unit tests and end-to-end run on a synthetic multi-tile archive with known ratios
- [x] One-year world configuration run on the same synthetic archive

## Next

1. **World, one year** (`config/world_test_2019.yaml`, see [06_global_scale.md](06_global_scale.md) §3):
   first real global factors, run time and disk.
2. **World, full record** (default configuration): the published result and the web overview. Until then
   the only real-data numbers are regional (Iberian Peninsula + Occitanie).
3. Confirm on real data: day/night split or pooled, K, the outages found by the screening.
4. Drift after 2019 by sub-region; in the regional pilot the 2024 departure came from Portugal alone
   (D-25): check whether the world run shows episodes of the same kind.
5. Three-way experiment for the presentation: raw MODIS, converted MODIS, real VIIRS on one region.
6. External validation: EFFIS and MCD64A1 burned area, the Aude 2025 fire, Landsat on 2–3 fires.

## Later

- Sensitivity to the confidence scenarios (Q1 / Q2 / Q3) and to K
- Prediction intervals for harmonized counts
- True observation opportunity (cloud-free overpasses) and partial-day gaps from the L2 fire masks
- Ecological super-regions (GFED basis regions) instead of UN sub-regions
- Per-year loading of the cell × month layer in the web app, for a finer world overview
- VIIRS 750 m (LAADS) comparison; change-point tests on the harmonized series
