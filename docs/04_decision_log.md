# 04 · Decision log

Each decision has a context, the decision, a rationale and a status. Changed decisions are never deleted; the
old decision is marked "superseded".

| # | Date | Decision | Rationale | Status |
|---|---|---|---|---|
| D-01 | 2026-11-11 | Pilot area Occitanie | Mediterranean seasonality, manageable data | **Superseded → D-12** |
| D-02 | 2026-11-11 | Pilot period 2012–2024; 2025–2026 independent test | Sensor difference is measured in the common period | **Superseded → D-13** |
| D-03 | 2026-11-11 | VIIRS: 375 m (FIRMS) first, then 750 m (LAADS) | FIRMS does not distribute 750 m | Accepted (750 m not started) |
| D-04 | 2026-11-11 | Grid EPSG:3035 + EEA alignment | Equal-area for Europe | **Superseded → D-14** |
| D-05 | 2026-11-11 | No deletion in QC; flags + Q1/Q2/Q3, main scenario Q1 | Reproducibility, sensitivity | Accepted |
| D-06 | 2026-11-11 | Main calibration: long-format NB (MODIS-equivalent) | Symmetric, no errors-in-variables | **Superseded → D-15** |
| D-07 | — | Calibration scale and training area | Data sufficiency | **Resolved → D-12, D-15** |
| D-08 | 2026-11-11 | No Z-score at 1 km; median (zeros included) + percentile | Zero-heavy distribution | Accepted (median implemented) |
| D-09 | 2026-11-11 | Terra–VIIRS not matched per overpass | ~3 h local time difference | Accepted (daily factor as a separate "terra" configuration) |
| D-10 | 2026-11-12 | Outage calendar: product operational period + known outages file | In regional data "no fire" and "no data" cannot be told apart | **Superseded → D-20** |
| D-11 | 2026-11-12 | Main series keeps `type` = 0 only (static sources excluded); factors to be split by day/night | Gas flares and industry are not fires; VIIRS gains more over MODIS at night | Accepted; day/night implemented in D-21 |
| D-12 | 2026-11-12 | **Test region: Iberian Peninsula + Occitanie** (660 727 km²), sub-regions Portugal / Spain / Occitanie | Occitanie has about 850 MODIS detections per year (2012–2019), too few for calibration. Global data is too large for the team. Iberia offers enough data and the Portugal August 2025 case | Accepted (user: "let's test a specific region in a world coordinate system") |
| D-13 | 2026-11-12 | Period 2012–2025. **Calibration ≤ 2019**, 2020–2024 orbit drift test, 2025 independent year | Pix'Elles: the Terra ratio rises after 2019 (12.2 → 16.4) | Accepted |
| D-14 | 2026-11-12 | **Grid EPSG:6933** (global EASE-Grid 2.0, equal-area), origin-based cell ids; 1 km layer only for non-empty cells | The same code and ids extend to the whole world later; 5 km ⊃ 25 × 1 km exactly nested | Accepted. Note: at 40°N a cell is about 1.13 × 0.88 km on the ground (area 1 km²) |
| D-15 | 2026-11-12 | **VIIRS-equivalent target scale**; hierarchical ratio factors from daily cell totals (all → region → 5 km cell → cell-month, K=50); 1 km cells inherit the 5 km factor; no regression model in the conversion | Validated in Pix'Elles; robust on sparse data; the challenge says "the sensor should no longer matter" | **Accepted** (2026-11-12, approved) |
| D-16 | 2026-11-13 | MODIS backcast to 2003 (`period.modis_start`); calibration and baseline unchanged | Long record is the main value of MODIS; pre-2012 years are MODIS × factor | Accepted |
| D-17 | 2026-11-14 | **Tile-partitioned pipeline**: integer cell ids, tiles of 400 × 400 cells in grid space, one Parquet file per tile and year; every stage per tile, resumable, parallel | A world run holds hundreds of millions of detections; cell ids as strings and whole-domain tables do not fit. Tiles in grid space keep cells whole | Accepted |
| D-18 | 2026-11-14 | Factor fit from sums: upper levels from domain-wide region × month sums, cell levels per tile; validation accumulated as moment sums | Exactly the same factors as a single fit (tested), with memory bounded by one tile | Accepted |
| D-19 | 2026-11-14 | World regions = countries, super-region = UN sub-region (new hierarchy level) | Available offline, stable names for the web app. Ecological regions (GFED basis regions, biomes) would be better parents: open | Accepted, to revisit |
| D-20 | 2026-11-14 | Outage calendar: known file + screening of domain-wide daily counts (world run only) | Replaces D-10. A regional run still cannot detect outages and must reuse the world calendar | Accepted |
| D-21 | 2026-11-14 | Day/night factors (`daynight: split`), always validated against pooled on the same cell-months | VIIRS gains more over MODIS at night, and the day/night mix varies between regions and seasons. Keep whichever has the lower held-out error | Accepted, default to confirm on real data |
| D-22 | 2026-11-14 | NOAA-20 / NOAA-21 as backup of the reference (own factors, region level at most), before MODIS; never summed | Continuity when S-NPP is down or ends; summing platforms multiplies observation opportunities | Accepted as **architecture**; **not validated on real FIRMS archives** in the published world run (2026-11-15 used MODIS + S-NPP only). Revisit when NOAA data are ingested |
| D-23 | 2026-11-14 | Every factor carries `f_se`; intervals use the held-out dispersion φ | Local uncertainty at global scale without bootstrapping millions of cells. Approximate | Accepted |
| D-24 | 2026-11-14 | Web: datasets = world overview (coarse cells, super-regions, no points) + detail windows (5 km, points); "Raw gap" and "After conv." comparison layers; timeline phases | A browser cannot hold the world at 5 km. The three-way comparison is the core evidence | Accepted |
| D-25 | 2026-11-14 | Wording: "aggregate consistency holds, single years can depart" instead of "the factor did not drift" | Pilot: 2020–2024 pooled 0.98 but 2024 = 0.82. By region: Portugal 0.70 (11 115 VIIRS detections), Spain 1.05, Occitanie 1.11. One region in one year, so a fire episode rather than orbit drift; to confirm with the region × month table | Accepted |
| D-26 | 2026-11-14 | **The world is the default configuration**; one year (2019) as first run; the Iberian run becomes a regional example (`config/iberia.yaml`) | The project targets the world. The regional run was a stepping stone (D-12: "global data is too large for the team" no longer holds with the tile pipeline) | Accepted |
| D-27 | 2026-11-15 | First world run (2003–2025, MODIS + S-NPP) accepted as the published result, with its limits stated | Factor 4.05, held-out ratio 0.98, region-month r 1.00, yearly 0.94–1.01 after calibration; agrees with the Pix'Elles prototype (Terra+Aqua 4.14–4.28, Terra 12.2) | Accepted |
| D-28 | 2026-11-15 | Day/night factors kept although they bring no gain at cell scale (MAE 4.39 against 4.34 pooled) | Day and night sensor ratios drift in opposite directions after 2022; to be re-examined | Open |
| D-29 | 2026-11-15 | Total-preserving rescaling of cell factors to be added | Converted totals are 0.93–0.97 of VIIRS inside the calibration years: the backcast is about 5% low | To do |
| D-30 | 2026-11-15 | Regional pilot removed from the repository (configuration, Occitanie boundary files, hand-made sub-region mode, outputs of the 2019 test run); unused helper functions deleted | The project is the world; the pilot remains documented in 05_version_comparison.md. A regional run = a smaller `aoi.bbox_wgs84` | Accepted |

