# 03 · Roadmap

Status date: 2026-11-15. Method: [01_methodology.md](01_methodology.md) · Decisions: [04_decision_log.md](04_decision_log.md) ·
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
- [x] Regional run on real data, Iberian Peninsula + Occitanie (2026-11-13, previous version of the code)
- [x] Unit tests and end-to-end run on a synthetic multi-tile archive with known ratios
- [x] One-year world configuration run on the same synthetic archive
- [x] **World run on real data, 2003–2025** (2026-11-15; MODIS + S-NPP)

## Next

Results of the first world run: [05_version_comparison.md](05_version_comparison.md) §5.

1. **Total-preserving correction** of the cell factors (the converted total is about 5% low inside the
   calibration years), then re-run stages 06 and 07.
2. **Volcanoes and static sources**: mask them in both sensors (Iceland 2021 is wrong by a factor of 40–70).
3. **Eastern Asia**: understand the low conversion (0.76 held-out).
4. Check the 24 detected outages against the FIRMS mission notes (Aqua August 2020, S-NPP 2024).
5. Download NOAA-20 and NOAA-21 and measure the backup factors on real data.
6. External validation: EFFIS and MCD64A1 burned area, known large fires on several continents.
7. Three-way experiment for the presentation: raw MODIS, converted MODIS, real VIIRS on one region.

## Later

- Sensitivity to the confidence scenarios (Q1 / Q2 / Q3) and to K
- Prediction intervals for harmonized counts
- True observation opportunity (cloud-free overpasses) and partial-day gaps from the L2 fire masks
- Ecological super-regions (GFED basis regions) instead of UN sub-regions
- Per-year loading of the cell × month layer in the web app, for a finer world overview
- VIIRS 750 m (LAADS) comparison; change-point tests on the harmonized series
