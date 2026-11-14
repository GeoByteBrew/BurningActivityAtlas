/** "diff" = raw VIIRS − raw MODIS; "convdiff" = MODIS converted − real VIIRS (VIIRS era only). */
export type Sensor = "harm" | "modis" | "viirs" | "diff" | "convdiff";
export type ColorMode = "count" | "anomaly";
export type Layer = "grid" | "points";
export type Basemap = "dark" | "satellite" | "bluemarble";

/** Inclusive month indices into `series.months` (0 = January of the first year). */
export interface Range {
  start: number;
  end: number;
}

export interface Coverage {
  start: string;
  end: string;
  n: number;
}

/** One entry of datasets.json: a self-contained folder under data/. */
export interface DatasetEntry {
  id: string;
  name: string;
  path: string;
  bbox: [number, number, number, number];
  cell_size_m: number;
  kind?: "overview" | "detail";
  n_cells?: number;
}

export interface Meta {
  title: string;
  dataset?: string;
  /** "super" (overview: UN sub-regions) or "region" (countries / sub-regions). */
  region_level?: string;
  /** false when the dataset ships no individual detections (coarse overview). */
  points?: boolean;
  points_dropped?: number;
  backup_platforms?: string[];
  daynight?: string;
  /** Domain the factors and validation tables were computed on. */
  validation_scope?: string;
  region_name: string;
  bbox: [number, number, number, number];
  period: [string, string];
  /** First VIIRS day; earlier years are MODIS-only (backcast). */
  viirs_start?: string;
  years: number[];
  regions: string[];
  platforms: string[];
  modis_platforms: string[];
  reference_platform: string;
  qc_scenario: string;
  qc_description: string;
  cell_size_m: number;
  n_cells: number;
  harmonized: boolean;
  calibration: {
    end: string;
    drift_test: [string, string];
    independent_test: [string, string];
    baseline_years: [number, number];
  };
  coverage: Record<string, Coverage>;
  qc_summary: Record<string, string | number>[];
  generated_at: string;
}

export interface Cells {
  size_m: number;
  regions: string[];
  id: string[];
  w: number[];
  s: number[];
  e: number[];
  n: number[];
  region: number[];
  frp_max: number[];
  modis_m: number[];
  viirs_m: number[];
}

/** Sparse cell × month values: cell index, month index, value. */
export interface Sparse {
  c: number[];
  k: number[];
  v: number[];
}

export interface CellsMonthly {
  months: string[];
  modis: Sparse;
  viirs: Sparse;
  harm?: Sparse;
  /** MODIS converted to VIIRS-equivalent on every day (counterfactual, for comparison with VIIRS). */
  conv?: Sparse;
  median?: { c: number[]; m: number[]; v: number[] };
}

export interface RegionSeries {
  count: Record<string, number[]>;
  frp: { modis: number[]; viirs: number[] };
  harm?: number[];
  conv?: number[];
  median?: number[];
  days?: number[];
}

export interface Series {
  months: string[];
  platforms: string[];
  regions: Record<string, RegionSeries>;
}

export type Row = Record<string, number | string>;

export interface Validation {
  factors: Row[];
  factors_region: Row[];
  test: Row[];
  test_region: Row[];
  by_year: Row[];
  by_region_year: Row[];
  annual_region: Row[];
  factors_dn?: Row[];
  test_daynight?: Row[];
  uncertainty?: Row[];
  outages?: Row[];
  scope?: string;
}

export interface Points {
  lon: number[];
  lat: number[];
  frp: number[];
  p: number[];
  doy: number[];
  night: number[];
  r: number[];
}

export interface PointSet extends Points {
  year: number[];
  k: number[];
}

export interface GeoJSON {
  type: "FeatureCollection";
  features: {
    properties: { name: string };
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
  }[];
}

export interface Dataset {
  /** Folder of this dataset under data/ ("" = legacy flat layout). */
  path: string;
  meta: Meta;
  cells: Cells;
  monthly: CellsMonthly;
  series: Series;
  validation: Validation;
  aoi: GeoJSON;
  /** cell × calendar month baseline mean of harmonized counts */
  normalDense: Float32Array;
}

export interface PickedPoint {
  lon: number;
  lat: number;
  frp: number;
  platform: string;
  date: string;
  night: boolean;
}
