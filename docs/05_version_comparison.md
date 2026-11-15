# 05 · Comparison of the successive versions of the method

Status: 2026-11-15. This document compares the current method with the versions that came before it:
what each one did, what the next one changed and why, and which results exist for which version.
The current method is described in [01_methodology.md](01_methodology.md); the decisions are dated in
[04_decision_log.md](04_decision_log.md).

## 1. The four versions

| | Version | Date | Status |
|---|---|---|---|
| **A** | Pix'Elles prototype (`harmonisation.py`), the team's first implementation | before 2026-11-11 | Ran on the world; results in the team's Drive |
| **B** | First design of this repository | 2026-11-11 | Designed, never run: replaced before calibration |
| **C** | Regional pilot, Iberian Peninsula + Occitanie | 2026-11-12 / 13 | Ran on real data; superseded by D |
| **D** | Current version: the world by default | 2026-11-14 / 15 | **Ran on the world, 2003–2025** (MODIS + S-NPP); source of the published numbers and of the web dataset |

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

**C · Regional pilot (run of 2026-11-13).**

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

**D · Current version (world, 2003–2025, run of 2026-11-15).** MODIS (Terra, Aqua) and VIIRS S-NPP from the
FIRMS yearly country files; 126 processing tiles, 233 countries in 24 sub-regions. NOAA-20 and NOAA-21 were
not downloaded, so the backup platforms were not exercised: S-NPP gaps are filled from MODIS.

| Quantity | Value |
|---|---|
| Terra+Aqua factor, 2012–2019 | 4.05 (90% interval 4.01–4.10); Aqua alone 6.10; Terra alone 12.1 |
| By day / night (Terra+Aqua) | day 3.48, night 8.87 |
| By sub-region (Terra+Aqua, ≥ 100 000 MODIS detections) | 3.36 (Southern Europe) to 5.47 (Southern Asia) |
| Held-out part of the calibration window (2017-08 → 2019) | raw MODIS / VIIRS 0.24 → converted / VIIRS 0.98; region-month correlation 1.00; cell-month Pearson 0.79; MAE 4.51 → 4.39 |
| VIIRS cell-months where MODIS saw nothing | 54% |
| Day/night factors against a single factor (held-out) | MAE 4.39 against 4.34; ratio 0.98 against 0.97; Pearson 0.79 against 0.77: no measurable difference |
| Converted / VIIRS by year, calibration years 2012–2019 | 0.93–0.97 |
| Converted / VIIRS by year, 2020–2025 | 0.95, 1.01, 0.95, 0.98, 0.99, 0.94 |
| Terra alone, 2020 → 2025 | 0.96 → 0.69 |
| Outages found by the screening | 24 (Terra 9, Aqua 6, S-NPP 9), among them Terra 19–27 Feb 2016 and 11–23 Oct 2022, Aqua 1–16 Apr 2022, S-NPP 27 Jul–10 Aug 2022 |
| Dispersion on held-out cell-months | φ = 2.9 |

What these results say:

- **The conversion works at regional scale on the whole world.** Raw MODIS sees a quarter of what VIIRS
  sees; after conversion the totals agree within a few percent and the region × month pattern is
  reproduced almost exactly.
- **Agreement with the prototype (A).** Terra+Aqua 4.05 against 4.14–4.28, Terra alone 12.1 against 12.2,
  and the same decline of Terra after 2019. Two independent implementations on different grids give the same
  factors. The slightly lower Terra+Aqua value is expected if the prototype keeps static sources (not checked).
- **A systematic low bias of about 5%.** Inside the calibration years the converted total is 0.93–0.97 of
  VIIRS, never 1. Cause: a cell factor is fitted where MODIS saw something, so the VIIRS detections of the
  cell-months where MODIS saw nothing are only partly carried by the levels above. A simulation reproduces
  the effect. Consequence: the MODIS-only years (2003–2011) are probably about 5% low relative to the VIIRS
  years. Not corrected in this run; see §7.
- **Terra+Aqua stays usable after 2019, Terra alone does not.** The combined ratio stays within 0.94–1.01.
  Day and night move in opposite directions after 2022 (VIIRS/MODIS by day 3.5 → 4.0, by night 9 → 7.5),
  the signature of the changing overpass times. Terra alone falls to 0.69 in 2025; no day of the record
  relies on Terra alone, so the series is unaffected.
- **Regions where it does not work well.** Eastern Asia is converted too low (0.76 held-out, 0.77–0.86 from
  2017 to 2022). Iceland is wrong by a factor of 40 to 70 in 2021 and Ecuador and Russia show months near
  zero: volcanic eruptions and winter industrial sources that the two products do not classify the same
  way. Small groups (Northern Europe, Western Europe, Pacific islands) are unstable.
- **Cell scale.** As in every version, the error of a single cell-month barely improves (4.51 → 4.39).

**Consequence for the reader.** The published numbers and the web dataset are version D results on MODIS
and S-NPP. The NOAA-20 / NOAA-21 backup has only been tested on synthetic data.

## 6. What no version solves

- A multiplier cannot recreate fires that MODIS did not see. In every version the conversion restores
  regional, monthly and yearly levels; values of single cells in single months stay highly uncertain.
- Clouds and missed overpasses: none of the versions knows whether a cell was actually observed. That
  requires the Level-2 fire masks, which FIRMS does not distribute.
- External validation against burned area (EFFIS, MCD64A1) or known fires (Aude 2025) has not been done
  for any version.
- Regions are administrative in C and D. Ecological regions would be better parents for the hierarchy.

## 7. Open after the first world run

1. **Total-preserving correction.** Rescale the cell factors of each region so that the converted total
   equals the VIIRS total over the calibration years; this should remove the 5% low bias of the backcast.
2. **Volcanoes and static sources.** The `type` field is not equivalent between the MODIS and VIIRS
   products (Iceland 2021). Mask known volcanoes and persistent hot spots in both sensors.
3. **Eastern Asia.** Find out why the ratio changes after 2016 (fire types, season, day or night).
4. **Outages.** Compare the 24 detected intervals with the FIRMS mission notes. The Aqua outage of
   August 2020 appears as three isolated days only, and S-NPP shows five short gaps in 2024: both to check.
5. **Backup platforms.** Download NOAA-20 and NOAA-21 and measure their factors on real data.
6. **Day/night.** No gain at cell scale; decide whether the opposite drifts of day and night after 2022
   justify keeping separate factors.
7. External validation against burned area and known fires.
