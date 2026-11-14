# 01 · Scientific methodology

Version 0.4 · 2026-11-14 · Scope: the world (default configuration); a region can be run with the
same code · Decisions: [04_decision_log.md](04_decision_log.md) · Earlier versions:
[05_version_comparison.md](05_version_comparison.md) · Scaling: [06_global_scale.md](06_global_scale.md)

## 0. Goals

1. **Harmonized Fire Activity Dataset**: comparable fire activity indicators from MODIS and VIIRS at
   1 km and 5 km, with the sensor differences measured and explained.
2. **Burning Activity Calendar**: daily, monthly and yearly calendar, seasonality, anomalies and regional
   comparison built from this dataset.

The outputs describe "fire activity" (active fire detection density). They are **not** burned area or
the number of fire events; those require validation against separate data sources (see §8).


## 1. Flow

```
FIRMS raw CSV ─► 02 QC (flags, no deletion; rows routed to tile/year partitions)
             ─► 04 Aggregation (per tile: overpasses, cell × day × platform counts, day/night)
             ─► 06 Harmonization (availability calendar → hierarchical factors → VIIRS-equivalent series)
             ─► Calendar (median with zeros, anomaly) ─► 07 Web datasets (world overview + detail windows)
```

## 2. Data and periods

| Period | Content of the harmonized series | Role |
|---|---|---|
| 2003–2011 | MODIS converted to VIIRS-equivalent (**backcast**, not a VIIRS observation) | Long record |
| 2012–2019 | VIIRS S-NPP observed | Calibration of the MODIS factors (stable Terra/Aqua orbits) |
| 2020–2024 | VIIRS S-NPP observed | Drift check of the MODIS factors; calibration of NOAA-20 / NOAA-21 |
| 2025 | VIIRS S-NPP observed | Independent test |

Scientific analyses use the standard products (SP). NRT data are used only for periods without SP and are
kept apart through the `source` field. Details: [02_data_sources.md](02_data_sources.md).

## 3. Quality control

No raw record is ever deleted. Every row gets flags (`data/processed/detections/<tile>/<year>.parquet`):

| Flag | Rule |
|---|---|
| `f_coord_ok` | -90 ≤ lat ≤ 90, -180 ≤ lon ≤ 180 |
| `f_time_ok` | UTC time parses and lies inside the analysis period |
| `f_platform_ok` | Platform (Terra/Aqua/S-NPP/NOAA-20/NOAA-21) recognised |
| `f_type_ok` | `type` = 0 (vegetation fire). Volcano, static source and offshore detections are excluded. NRT has no `type` (`f_type_known`=False) |
| `f_duplicate` | Technical duplicate: same source, time and coordinates |
| `f_grid_ok` | The position projects onto the grid |
| `f_in_aoi` | Regional run: point inside one of the regions. World run: always true; `region` stays empty where no country claims the point (after snapping to the nearest coast within 0.25°) |

**Confidence scenarios.** The scales are not equivalent: MODIS is numeric 0–100, VIIRS categorical l/n/h.
Following the C6 user guide, MODIS classes are low 0–29, nominal 30–79, high 80–100.

| Scenario | MODIS | VIIRS | Role |
|---|---|---|---|
| Q1 | conf ≥ 30 | n, h | Main analysis |
| Q2 | conf ≥ 80 | h | Strict (sensitivity) |
| Q3 | all | l, n, h | Loose (sensitivity) |

All results are produced with Q1. Q2 and Q3 are used to report how much the results change.


## 4. Spatial harmonization

- **CRS:** EPSG:6933 (WGS 84 / NSIDC EASE-Grid 2.0 Global, cylindrical equal-area). One projection for
  the whole world: a cell has the same area everywhere (at 40° latitude a 1 km² cell is about
  1.13 × 0.88 km on the ground).
- **Cells:** counted from the projection origin: column `i = floor(x / size)`, row `j = floor(y / size)`.
  A cell id is one 64-bit integer packing (i, j); the readable form is `5kmE{i}N{j}`. Every 5 km cell
  contains exactly 25 cells of 1 km, so 5 km counts are the sum of the 1 km counts.
- **Assignment** is arithmetic; there is no spatial join and no polygon layer. Polygons exist only for a
  regional run (`grid.materialize_m`) or on demand for non-empty cells.
- **Processing tiles:** blocks of 400 × 400 cells of 5 km (2000 km). Cells nest in tiles exactly, so
  no cell is ever split between two partitions.
- **Regions:** each detection gets a region (its country) and each region a super-region (its UN
  sub-region). A regional run can use hand-made sub-regions instead. A 5 km cell belongs to the region holding most of its
  detections. Countries are an administrative choice, not an ecological one: the cell and cell-month
  levels of the factor hierarchy carry the local behaviour, the regions only stabilise sparse cells.

**Scale and pixel size warning.** A MODIS pixel is about 1×1 km at nadir and about 4.8×2 km at the scan
edge. The VIIRS 375 m pixel grows to about 0.8×0.75 km at the edge. The hotspot coordinate is the pixel
centre, so a 1 km cell gives MODIS a false precision. `scan`, `track` and `pixel_area_km2` are stored for
every detection. The **1 km scale** is a detection and visualisation layer; **factors are fitted at 5 km**
and 1 km cells inherit the factor of their 5 km parent.

## 5. Temporal harmonization

**Overpass.** A new overpass starts when consecutive detections of the same platform are more than 20
minutes apart, **within one processing tile** (2000 km): over the whole globe a platform is always
detecting something somewhere, so time gaps only separate overpasses regionally. FIRMS only contains
detections; overpasses without any detection are invisible. A true overpass schedule needs orbit and
geolocation data (not done).

**Near-simultaneous matching.** Two overpasses are matched when their mid-times differ by ±5 minutes or
less. Tolerances of 10 and 20 minutes are used for sensitivity analysis.

| Pair | Equator crossing (approx.) | Simultaneous |
|---|---|---|
| Aqua – S-NPP | 13:30 / 01:30 | **Yes**: the core calibration pair |
| Aqua – NOAA-20 / NOAA-21 | NOAA-20 is about half an orbit (~50 min) ahead of S-NPP | Limited. The number of matches is measured in the report |
| Terra – VIIRS | 10:30 / 22:30 | No. Comparable only at daily scale and with a diurnal-cycle correction |

**Orbit drift.** In recent years Terra and Aqua no longer maintained their altitude and equator crossing
time, so their overpass times drifted. Because of the diurnal fire cycle, this drift alone can create a
trend. The overpass time distribution is therefore monitored per year and platform (see §8, historical
consistency).

**Repeated detections.**
1. Technical repeats within one overpass: same coordinates and time (`f_duplicate`), plus the edge
   overlap of consecutive MODIS scans (bow-tie). The latter needs the scan geometry (not done).
2. The same fire in different overpasses: **not deleted**. Multi-day activity is real temporal
   information. Event-level tracking will be a separate module (Fire Event Tracking).

**Aggregation.** Overpass → UTC day → calendar month. Days are UTC days everywhere. Far from the
Greenwich meridian one local night is split over two UTC days; this moves counts between neighbouring
days but not between sensors (every platform is cut at the same instant), so monthly ratios and totals
are unaffected. Daily values far from 0° longitude should be read with that in mind.


## 6. Harmonization: hierarchical ratio factors on the VIIRS-equivalent scale

### 6.1 Reference, predictors, one source per day

The reference is one VIIRS platform (S-NPP), so the target series has a single, constant observing
system. A **predictor** is a set of platforms that can stand in for it:

| Priority | Predictor | Calibrated on | Deepest level |
|---|---|---|---|
| 1 | NOAA-20 | its overlap with S-NPP up to 2024 | region |
| 2 | NOAA-21 | its overlap with S-NPP up to 2024 | region |
| 3 | Terra + Aqua | 2012–2019 | cell-month |
| 4 | Terra only | 2012–2019 | cell-month |
| 5 | Aqua only | 2012–2019 | cell-month |

For every day the series takes **one** source: S-NPP when it works, otherwise the first predictor whose
platforms all work, multiplied by its factor. Sources are never summed: adding NOAA-20 and NOAA-21 to
S-NPP would triple the observation opportunities and create a false increase after 2018.
VIIRS-to-VIIRS factors are close to 1 and are not fitted below the region level, where their cell ratios
are sampling noise (the platforms see the same fires 50 minutes apart and from different angles).

### 6.2 Availability calendar

`ok(platform, day)` = inside the product's operational period, minus outages. Outages come from

1. `data/ancillary/outages.csv` (known events, always applied), and
2. **screening of domain-wide daily counts** (`mvh.harmonize.detect_outages`, world run): a day is an
   outage when a platform's count falls below 10 % of its usual level (centred 61-day median; inside
   long gaps, a third of the same-season level of other years). Platforms under 200 detections/day are
   not screened.

The screening needs a domain where every platform sees fire every day. A regional run cannot do it (a
day without fires is not a day without data): it should reuse `outages_used.csv` of a world run.
Limitation: partial-day or regional data gaps (missing granules) are not detected; that requires the
L2 fire masks ([02_data_sources.md](02_data_sources.md) §4).

### 6.3 Factors

On days when the reference and a predictor both work, per stratum:

```
f = Σ reference detections / Σ predictor detections
```

Strata are the predictor and, with `harmonization.daynight: split`, the day or night half (the VIIRS gain
over MODIS is larger at night, and the day/night mix differs between regions and seasons). Levels:

```
all → super-region → region → 5 km cell → cell × calendar month
```

A level with `m` predictor detections uses `w = m / (m + K)` of its own ratio and `1 − w` of its parent's
(K = 50). The same formula gives an FRP factor from FRP sums.

**Why a ratio and not a regression.** The factor is a ratio of sums: it needs no zero handling, it is
additive (the fit only needs sums per cell × month × stratum), and it cannot be biased by noise in the
predictor the way a regression slope is. Its limit is stated in §6.5.

### 6.4 Validation design

- **Held-out part of each calibration window** (chronological 70 / 30 split, month resolution): factors
  fitted on the first part are scored on the second, per cell-month, day and night summed. Split and pooled
  day/night factors are scored on the same cell-months and reported side by side.
- **Drift check**: with the final factors, converted / real VIIRS per year, per super-region and per
  region × month after the calibration window; reference / predictor ratio per year for day and for night
  (a drift confined to one half points to overpass time).
- **Independent year** (2025).
- Scores: ratio of totals, cell-month MAE and Pearson, Spearman where both sensors saw fire, region-month
  correlation, share of reference cell-months where the predictor saw nothing.

### 6.5 What the factor does and does not do

It restores **levels**: regional, monthly and yearly totals, seasonality, trends. It does **not**
reconstruct VIIRS hotspots: where MODIS saw nothing (more than half of the cell-months with VIIRS fire in
the Iberian regional run) a multiplier returns nothing, and the cell-month error barely improves. The harmonized record
is a record of activity levels on the VIIRS scale, not a 375 m reconstruction. An anomaly is a number of
detections above or below the usual count; it is not burned area, a number of fires or an intensity.

### 6.6 Uncertainty

- **Upper levels** (all, super-region, region; pooled and by day/night): 90 % percentile interval from a
  block bootstrap over calendar months.
- **Every factor** (down to cell-month) carries `f_se`, a log-scale standard error for Poisson counts:
  `sqrt((1 + 1/f) / (m + K) + ((1 − w) · se_parent)²)`. The prior is counted as K predictor detections,
  consistently with the shrinkage weight.
- **Dispersion φ** is measured on held-out cell-months (`Σ (v − v̂)² / Σ v̂ (1 + f)`); it carries the
  clustering of fire pixels and the fires the predictor misses. Approximate 90 % interval:
  `f · exp(± 1.645 · √φ · f_se)` (`mvh.harmonize.interval`).

This interval is an approximation meant to rank how far a local factor can be trusted. It is not a
calibrated posterior, and it is an interval on the factor, not a prediction interval on a harmonized
count (which would also need the count's own sampling error).

### 6.7 Overpass-level diagnostic

The exploration report (`scripts/05_explore_report.py`) matches Aqua and S-NPP overpasses within ±5
minutes and compares their counts per cell. It is a physical check of the sensor ratio under nearly
identical viewing time, not part of the conversion. The first design of the project planned a regression
(negative binomial) on these matched pairs; it was replaced by the ratio factors (decision D-15) and
is not implemented.

## 7. Calendar

- Monthly harmonized detections per cell and per region.
- **Normal** = median over the baseline years (2012–2024) for the same calendar month, counting years
  without any detection as zero. In a single 5 km cell the median is mostly 0, so the web app uses the
  baseline mean with a damped ratio `(n + 2) / (normal + 2)`.
- Anomaly = harmonized − normal (and ratio to normal at region level).

## 8. Validation still to do, and limitations

| Check | Question | Method |
|---|---|---|
| Three-way experiment | What does the method correct, and what not? | Raw MODIS / converted MODIS / real VIIRS on the same region, period and 5 km grid (web: *Compare sensors*; report §4) |
| Historical consistency | Artificial jump at 2012, or at an outage? | Change-point tests (Pettitt, CUSUM) on the harmonized series |
| External validation | Does activity agree with burned area? | EFFIS, MCD64A1, BDIFF; Aude 2025; Landsat on 2–3 fires |
| Sensitivity | Q1 / Q2 / Q3, K, 750 m VIIRS | Re-run of stage 06 |

**Limitations.** Hotspot counts are not fire area or event counts. Clouds and missing overpasses create
undetected fires that no factor recovers. Small agricultural burns are systematically missed by MODIS.
Terra and Aqua are drifting: MODIS factors calibrated on 2012–2019 are checked, not guaranteed, afterwards.
After MODIS and S-NPP end, continuity rests on the NOAA-20 / NOAA-21 factors.

## References

- Li, F., Zhang, X., Kondragunta, S., Csiszar, I. (2018). Comparison of Fire Radiative Power Estimates
  From VIIRS and MODIS Observations. *JGR Atmospheres*, 123. https://doi.org/10.1029/2017JD027823
- Giglio, L., Schroeder, W., Hall, J. V., Justice, C. O. (2018/2021). *MODIS Collection 6/6.1 Active Fire
  Product User's Guide*.
- Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. (2014). The New VIIRS 375 m active fire detection
  data product. *Remote Sensing of Environment*, 143, 85–96.
- NASA FIRMS: https://firms.modaps.eosdis.nasa.gov/ (Active Fire Data, API, Fire Alert Notes)
