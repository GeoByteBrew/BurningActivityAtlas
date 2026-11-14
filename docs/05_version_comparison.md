# 05 · Comparison of the successive versions of the method

Status: 2026-11-14. This document compares the current method with the versions that came before it:
what each one did, what the next one changed and why, and which results exist for which version.
The current method is described in [01_methodology.md](01_methodology.md); the decisions are dated in
[04_decision_log.md](04_decision_log.md).

## 1. The four versions

| | Version | Status |
|---|---|---|
| **A** | Pix'Elles prototype (`harmonisation.py`), the team's first implementation | Ran on the world; results in the team's Drive |
| **B** | First design | Designed, never run: replaced before calibration |
| **C** | Regional pilot, Iberian Peninsula + Occitanie | Ran on real data with a single day/night factor |
| **D** | Current version: the world by default | Code and tests complete; **not yet run on real data** |

## 2. Side by side

| Topic | A · Pix'Elles prototype | B · First design | C · Regional pilot | D · Current |
|---|---|---|---|---|
| Coverage | World | Occitanie | Portugal, Spain, Occitanie | Region or world, same code |
| Grid | 0.25° / 0.5° latitude-longitude (cell area varies with latitude) | EPSG:3035, 1 km and 5 km (Europe only) | EPSG:6933, 1 km and 5 km (global, equal-area) | Same as C; integer cell ids, processing tiles |
| Target scale | VIIRS-equivalent | MODIS-equivalent | VIIRS-equivalent | VIIRS-equivalent |
| Conversion | Ratio Σ VIIRS / Σ MODIS on cell-day totals | Negative binomial regression on matched overpasses | Ratio, as A | Ratio, as A |
| Hierarchy | cell-month → cell → global, K = 50 | none | all → region → cell → cell-month, K = 50 | all → super-region → region → cell → cell-month, K = 50 |
| Day / night | one factor | covariate in the regression | one factor | separate factors, compared with the single factor on the same held-out data |
| MODIS configurations | Terra+Aqua, Terra, Aqua | per platform | Terra+Aqua, Terra, Aqua | Terra+Aqua, Terra, Aqua |
| VIIRS platforms | S-NPP | S-NPP, NOAA-20, NOAA-21 analysed separately | S-NPP as reference; NOAA-20/21 downloaded, shown, not used | S-NPP as reference; NOAA-20, then NOAA-21, as backup with their own factors |
| One source per day | yes (VIIRS, else MODIS × factor) | sensors not pooled | yes | yes (S-NPP, else NOAA-20, NOAA-21, then MODIS) |
| Outages | global calendar from daily counts (`jours.csv`) | none | operational periods only; outages file foreseen but empty | known outages file + screening of domain-wide daily counts |
| Calibration period | 2012–2019 | 2012–2021 | 2012–2019 | MODIS 2012–2019; NOAA-20/21 on their overlap with S-NPP up to 2024 |
| Quality filter | MODIS conf ≥ 30, VIIRS n/h; `type` 0 and 2 | flags, three scenarios, `type` 0 | as B | as B |
| Validation | chronological 70/30 split, yearly ratio table | temporal and spatial block CV (planned) | 70/30 split, yearly drift check, independent year 2025 | as C, plus per super-region, region × month, day/night ratio by year |
| Uncertainty | none | intervals planned | 90% bootstrap interval for global and regional factors | as C, plus a standard error for every factor and a dispersion measured on held-out data |
| Anomaly | median, fire-free years counted as zero | Z-score | median with zeros | median with zeros |
| Data volume handled | world on a coarse grid | one region in memory | one region in memory (~1 M detections) | tile by tile; memory bounded by the busiest tile |
| Web app | none | none | one dataset, 5 km cells | world overview + regional windows; raw gap and after-conversion layers |

## 3. What each step changed, and why

**A → B.** The first design of this repository aimed at what the challenge asks for and the prototype lacked: a
1 km / 5 km equal-area grid, quality flags without deletion, overpass-level physics, uncertainty. It chose a
regression on near-simultaneous Aqua–S-NPP overpasses and a MODIS-equivalent target.

**B → C.** Version B was abandoned before any calibration for three reasons (decisions D-12 to D-15):

- Occitanie alone has about 850 MODIS detections per year: too few to calibrate anything locally.
- The prototype had already shown that ratio factors with hierarchical shrinkage work on sparse data, and
  that the Terra/Aqua ratio drifts after 2019. Both were adopted: ratio factors, calibration on 2012–2019.
- VIIRS is the sensor that continues; a VIIRS-equivalent scale keeps the record usable after MODIS ends.

Version C is therefore the prototype's statistical core on this repository's grid, quality control and
validation, with EPSG:6933 replacing EPSG:3035 so that the same cell ids are valid anywhere on Earth.
The overpass matching of version B survives as a diagnostic in the exploration report; the regression
was never implemented.

**C → D.** The review of the pilot found six weaknesses; version D addresses them and removes what tied the
code to one region.

| Weakness of C | In D |
|---|---|
| A satellite counted as available on every day of its mission | Outage calendar (decision D-20) |
| One factor for day and night | Day/night factors, validated against the single factor (D-21) |
| NOAA-20 and NOAA-21 unused; no continuity if S-NPP stops | Backup platforms with their own factors, never summed (D-22) |
| "The factor did not drift" stated although 2024 = 0.82 | Wording corrected; diagnostics by region × month and by day/night (D-25) |
| Uncertainty for global and regional factors only | Standard error for every factor, held-out dispersion (D-23) |
| Map "Difference" = raw VIIRS − raw MODIS only | Renamed "Raw gap"; "After conv." layer added (D-24) |
| Whole domain in memory, string cell ids, one polygon per cell | Tiles, integer ids, no polygon layer (D-17, D-18) |
| Three hand-made sub-regions | Countries and UN sub-regions for the world (D-19) |

## 4. What has not changed since the prototype

The statistical core is the same in A, C and D: a ratio of sums on days when both sensors work, shrunk
towards the level above with weight m / (m + K), K = 50; one source per day; calibration of MODIS on
2012–2019; median-based anomalies. Version D fits exactly the same factors as version C would on the
same data, strata and hierarchy: computing the upper levels from domain-wide sums and the cell levels
tile by tile is tested to give identical results to a single fit.

## 5. Results available for each version

Results are only comparable within a version: region, grid and quality filter differ between them.

**A · Pix'Elles prototype (world, 0.25°).** As reported by the team: Terra+Aqua ratio stable at 4.14–4.28
over 2012–2019, rising to 4.66 in 2025; Terra alone from 12.2 (2019) to 16.4 (2025); cell error metric
reduced from 55.5 to 19.8; FRP factor 0.90 for Terra+Aqua.

**B · First design.** None.

**C · Regional pilot.**

| Quantity | Value |
|---|---|
| Terra+Aqua factor | 2.96 (90% interval 2.88–3.07) |
| By region | Occitanie 3.10, Portugal 2.71, Spain 3.17 |
| Held-out part of 2012–2019 | converted / VIIRS 0.98; region-month correlation 0.99; cell-month MAE 2.39 → 2.90 |
| Independent year 2025 | raw MODIS / VIIRS 0.35 → converted / VIIRS 1.03; cell-month MAE 5.21 → 4.29; Pearson 0.91 |
| VIIRS cell-months where MODIS saw nothing (2025) | 57% |
| Converted / VIIRS by year, 2020–2024 | 1.00, 1.05, 1.09, 0.95, 0.82 (pooled 0.98) |
| 2024 by region | Portugal 0.70, Spain 1.05, Occitanie 1.11 |

The pilot factor (about 3) and the prototype's (about 4.2) are not in contradiction: the prototype covers the
world and keeps static sources (`type` 2), the pilot covers south-west Europe with vegetation fires only.

**D · Current version.** No result on real data yet. It has been run end to end on a synthetic archive of
one million detections over nine tiles, built with known ratios (day 3, night 6, × 1.5 in one region, a
16-day S-NPP outage): the pipeline recovers the ratios, finds the outage with its exact dates and fills it
from NOAA-20. This shows that the code does what it is designed to do; it says nothing about how well the
design fits real fires.

**Consequence for the reader.** Until version D is run on real data, the only real-data numbers are
version C results: single day/night factor, no outage calendar, no backup platform.

## 6. What no version solves

- A multiplier cannot recreate fires that MODIS did not see. In every version the conversion restores
  regional, monthly and yearly levels; values of single cells in single months stay highly uncertain.
- Clouds and missed overpasses: none of the versions knows whether a cell was actually observed. That
  requires the Level-2 fire masks, which FIRMS does not distribute.
- External validation against burned area (EFFIS, MCD64A1) or known fires (Aude 2025) has not been done
  for any version.
- Regions are administrative in C and D. Ecological regions would be better parents for the hierarchy.

## 7. Open questions that the first real run of version D should answer

1. Do day/night factors reduce the held-out error on real data, or is the single factor enough?
2. Which outages does the screening find, and do they match the mission anomaly notes?
3. Does the Portugal 2024 departure come from a few fire days, and from day or from night detections?
4. How far are the NOAA-20 and NOAA-21 factors from 1, and are they stable from year to year?
5. Do the world factors of version D agree with those of the prototype once static sources are excluded?
