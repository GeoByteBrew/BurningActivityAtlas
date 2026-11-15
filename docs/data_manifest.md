# Raw FIRMS data manifest (published world run)

AI disclosure: drafted with the assistance of a large language model. See [AI_USE.md](../AI_USE.md).

The raw detections are **not** stored in git (`data/raw/` is ignored). This file records what the
published global analysis of **2026-11-15** used, so a third party can obtain the same archives.

## Products used

| Data | FIRMS source folder | Coverage | Role |
|---|---|---|---|
| MODIS MCD14ML Collection 6.1 | `data/raw/world/MODIS_SP/` | 2003–2025 | Calibration predictor + pre-2012 backcast |
| VIIRS S-NPP VNP14IMG | `data/raw/world/VIIRS_SNPP_SP/` | 2012–2025 | Reference series and validation |

Acquisition: **FIRMS yearly country archive** downloads (portal), not the area API.
Portal: <https://firms.modaps.eosdis.nasa.gov/>

## Products not used (this version)

| Data | Status |
|---|---|
| VIIRS NOAA-20 (VJ114IMG) | Not downloaded; code/tests only |
| VIIRS NOAA-21 (VJ214IMG) | Not downloaded; code/tests only |

## Layout expected by the pipeline

```
data/raw/world/
├── MODIS_SP/
│   └── … yearly country CSV files (any nesting; `type` column required)
└── VIIRS_SNPP_SP/
    └── … yearly country CSV files (any nesting; `type` column required)
```

`scripts/02_quality_control.py` reads every CSV under those folders and routes rows to processing tiles.

## Checksums

Fill this table when archives are re-downloaded or deposited (Zenodo / GitHub Release), so readers can
verify bit-identity with the published run.

| Relative path or archive name | Bytes | SHA-256 | Notes |
|---|---|---|---|
| *(to be filled)* | | | |

## Related outputs (in git)

| Path | Contents |
|---|---|
| `outputs/world_multiyear/` | Factors, validation CSV, figures, harmonization report |
| `web/public/data/` | Web snapshot used by the atlas |
| GitHub Release `data-v1` | Packaged web datasets (when published) |
