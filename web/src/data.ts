// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import type { Cells, CellsMonthly, Dataset, DatasetEntry, GeoJSON, Meta, Points, Range, RegionSeries, Sensor, Series, Validation } from "./types";

const BASE = `${import.meta.env.BASE_URL}data`;

/** True when a body looks like JSON (Vite SPA fallback returns 200 HTML for missing /data/*.json). */
function looksJson(text: string) {
  const c = text.trimStart()[0];
  return c === "{" || c === "[";
}

/** Load JSON; if the plain file is missing, try the gzipped twin (large world / regional tables). */
async function getJson<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}/${name}`);
  if (r.ok) {
    const text = await r.text();
    if (looksJson(text)) return JSON.parse(text) as T;
  } else if (r.status !== 404) {
    throw new Error(`${name}: HTTP ${r.status}`);
  }
  if (!name.endsWith(".json")) throw new Error(`${name}: HTTP ${r.status}`);
  const gz = await fetch(`${BASE}/${name}.gz`);
  if (!gz.ok || !gz.body) throw new Error(`${name}: HTTP ${r.ok ? 404 : r.status}`);
  // Vite may already decode Content-Encoding: gzip; Vercel often serves raw bytes.
  const buf = await gz.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(1, buf.byteLength))[0];
  const text =
    head === 0x1f
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(buf);
  if (!looksJson(text)) throw new Error(`${name}: not JSON`);
  return JSON.parse(text) as T;
}

/** Datasets available on this deployment; a flat data/ folder (older exports) counts as one. */
export async function loadIndex(): Promise<{ default: string; datasets: DatasetEntry[] }> {
  try {
    return await getJson("datasets.json");
  } catch {
    return { default: "", datasets: [{ id: "", name: "", path: "", bbox: [-180, -60, 180, 84], cell_size_m: 5000 }] };
  }
}

const cellLabel = (size_m: number) => `${size_m / 1000} km`;
export const cellSizeLabel = (meta: Meta) => cellLabel(meta.cell_size_m);

export async function loadDataset(path = ""): Promise<Dataset> {
  const dir = path ? `${path}/` : "";
  const [meta, cells, monthly, series, validation, aoi] = await Promise.all([
    getJson<Meta>(`${dir}meta.json`),
    getJson<Cells>(`${dir}cells.json`).catch(() => getJson<Cells>(`${dir}cells_5km.json`)),
    getJson<CellsMonthly>(`${dir}cells_monthly.json`),
    getJson<Series>(`${dir}series.json`),
    getJson<Validation>(`${dir}validation.json`).catch(() => ({}) as Validation),
    getJson<GeoJSON>(`${dir}aoi.json`),
  ]);
  const normalDense = new Float32Array(cells.id.length * 12);
  const h = monthly.harm;
  const [b0, b1] = meta.calibration?.baseline_years ?? [meta.years[0], meta.years[meta.years.length - 1]];
  const k0 = (b0 - meta.years[0]) * 12;
  const k1 = (b1 - meta.years[0]) * 12 + 11;
  if (h) {
    for (let i = 0; i < h.c.length; i++) if (h.k[i] >= k0 && h.k[i] <= k1) normalDense[h.c[i] * 12 + (h.k[i] % 12)] += h.v[i];
    const n = b1 - b0 + 1;
    for (let i = 0; i < normalDense.length; i++) normalDense[i] /= n;
  }
  return { path, meta, cells, monthly, series, validation, aoi, normalDense };
}

const pointCache = new Map<string, Promise<Points>>();

export function loadPoints(path: string, year: number): Promise<Points> {
  const key = `${path ? `${path}/` : ""}points_${year}.json`;
  if (!pointCache.has(key)) pointCache.set(key, getJson<Points>(key));
  return pointCache.get(key)!;
}

/** First month index with VIIRS data; before it only converted MODIS exists. */
export function viirsStartIndex(meta: Meta): number {
  const d = meta.viirs_start ?? meta.period[0];
  return Math.max(0, (Number(d.slice(0, 4)) - meta.years[0]) * 12 + Number(d.slice(5, 7)) - 1);
}

// ---------- ranges ----------

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fullRange = (meta: Meta): Range => ({ start: 0, end: meta.years.length * 12 - 1 });
export const yearRange = (meta: Meta, y: number): Range => {
  const s = (y - meta.years[0]) * 12;
  return { start: s, end: s + 11 };
};
export const monthRange = (meta: Meta, y: number, m: number): Range => {
  const k = (y - meta.years[0]) * 12 + m;
  return { start: k, end: k };
};
export const rangeLen = (r: Range) => r.end - r.start + 1;
export const yearOf = (meta: Meta, k: number) => meta.years[0] + Math.floor(k / 12);
export const isFull = (meta: Meta, r: Range) => r.start === 0 && r.end === meta.years.length * 12 - 1;
/** A whole calendar year, or null. */
export const singleYear = (meta: Meta, r: Range): number | null =>
  r.start % 12 === 0 && rangeLen(r) === 12 ? yearOf(meta, r.start) : null;
export const inRange = (r: Range, k: number) => k >= r.start && k <= r.end;

export function rangeLabel(meta: Meta, r: Range): string {
  const y0 = yearOf(meta, r.start);
  const y1 = yearOf(meta, r.end);
  const m0 = MONTHS[r.start % 12];
  const m1 = MONTHS[r.end % 12];
  if (r.start === r.end) return `${m0} ${y0}`;
  if (r.start % 12 === 0 && r.end % 12 === 11) return y0 === y1 ? String(y0) : `${y0}–${y1}`;
  if (y0 === y1) return `${m0}–${m1} ${y0}`;
  return `${m0} ${y0} – ${m1} ${y1}`;
}

/** Same calendar months in every year, when the range sits inside one year. */
export function samePeriodAcrossYears(meta: Meta, r: Range): Range[] | null {
  if (yearOf(meta, r.start) !== yearOf(meta, r.end) || rangeLen(r) === 12) return null;
  const a = r.start % 12;
  const b = r.end % 12;
  return meta.years.map((_, yi) => ({ start: yi * 12 + a, end: yi * 12 + b }));
}

// ---------- aggregation ----------

export function sumRange(arr: number[] | undefined, r: Range): number {
  if (!arr) return 0;
  let s = 0;
  for (let k = r.start; k <= r.end; k++) s += arr[k] ?? 0;
  return s;
}

/** Expected (normal) total over a range from a 12-value calendar median. */
export function medianRange(median12: number[] | undefined, r: Range): number {
  if (!median12) return 0;
  let s = 0;
  for (let k = r.start; k <= r.end; k++) s += median12[k % 12];
  return s;
}

/**
 * Per-cell totals over a range for one sensor view.
 * "diff" = raw VIIRS − raw MODIS (the sensor gap); "convdiff" = MODIS converted − real VIIRS
 * (what the conversion leaves behind), counted from the first full VIIRS month only.
 */
export function cellRangeValues(ds: Dataset, sensor: Sensor, r: Range): Float64Array {
  const out = new Float64Array(ds.cells.id.length);
  const add = (sp: { c: number[]; k: number[]; v: number[] } | undefined, sign: number, from = 0) => {
    if (!sp) return;
    const lo = Math.max(r.start, from);
    for (let i = 0; i < sp.c.length; i++) {
      const k = sp.k[i];
      if (k >= lo && k <= r.end) out[sp.c[i]] += sign * sp.v[i];
    }
  };
  if (sensor === "diff") {
    add(ds.monthly.viirs, 1);
    add(ds.monthly.modis, -1);
  } else if (sensor === "convdiff") {
    const from = viirsStartIndex(ds.meta) + 1;
    add(ds.monthly.conv, 1, from);
    add(ds.monthly.viirs, -1, from);
  } else add(ds.monthly[sensor], 1);
  return out;
}

/** Per-cell normal (baseline median) totals over a range. */
export function cellRangeMedians(ds: Dataset, r: Range): Float64Array {
  const cnt = new Array(12).fill(0);
  for (let k = r.start; k <= r.end; k++) cnt[k % 12]++;
  const N = ds.cells.id.length;
  const out = new Float64Array(N);
  const md = ds.normalDense;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let m = 0; m < 12; m++) if (cnt[m]) s += cnt[m] * md[i * 12 + m];
    out[i] = s;
  }
  return out;
}

/** Ratio to normal for region-level totals; activity on a zero normal counts as strongly above normal. */
export function ratioToNormal(v: number, med: number): number {
  if (med > 0) return v / med;
  return v > 0 ? 4 : 1;
}

/** Cell-level ratio, damped by a pseudo-count so a single detection in a quiet cell is not "4×". */
export const cellRatio = (v: number, normal: number, prior = 2) => (v + prior) / (normal + prior);

export interface RegionMonthly {
  harm: number[];
  conv: number[];
  modis: number[];
  viirs: number[];
  median: number[];
  days: number[];
}

/** Monthly series of a region: harmonized, MODIS converted, raw MODIS (Terra+Aqua), raw VIIRS (reference). */
export function regionMonthly(meta: Meta, rs: RegionSeries): RegionMonthly {
  const n = Object.values(rs.count)[0]?.length ?? 0;
  const zeros = () => new Array(n).fill(0);
  const modis = zeros();
  for (const p of meta.modis_platforms) rs.count[p]?.forEach((v, k) => (modis[k] += v));
  const viirs = rs.count[meta.reference_platform] ?? zeros();
  return {
    harm: rs.harm ?? viirs,
    conv: rs.conv ?? zeros(),
    modis,
    viirs,
    median: rs.median ?? new Array(12).fill(0),
    days: rs.days ?? zeros(),
  };
}

export function sum(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString("en-US");
}

export const fmtRatio = (x: number) => (Number.isFinite(x) ? `${x >= 10 ? x.toFixed(0) : x.toFixed(1)}×` : "–");

export function cellRow(arr: number[] | undefined, i: number, width: number): number[] {
  return arr ? arr.slice(i * width, (i + 1) * width) : new Array(width).fill(0);
}

/** Monthly series of one cell for a sparse layer, aligned to series.months. */
export function cellMonthly(ds: Dataset, layer: "modis" | "viirs" | "harm", i: number): number[] {
  const out = new Array(ds.monthly.months.length).fill(0);
  const sp = ds.monthly[layer];
  if (sp) for (let j = 0; j < sp.c.length; j++) if (sp.c[j] === i) out[sp.k[j]] += sp.v[j];
  return out;
}

export function byYear(meta: Meta, monthly: number[]): number[] {
  return meta.years.map((_, yi) => {
    let s = 0;
    for (let m = 0; m < 12; m++) s += monthly[yi * 12 + m] ?? 0;
    return s;
  });
}
