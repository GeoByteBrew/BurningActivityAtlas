export const SENSOR_COLORS = {
  modis: "#ff8a3d",
  viirs: "#38d0ff",
  harm: "#ffb347",
  conv: "#c9a6ff",
  median: "#8d99ad",
} as const;

// Ratio to normal: quieter (blue) ← normal (grey) → more active (red).
const ANOMALY: [number, number, number][] = [
  [52, 120, 220],
  [110, 160, 215],
  [120, 128, 142],
  [240, 120, 70],
  [255, 52, 52],
];

// Sequential fire ramp (dim ember → deep red → bright red). Its top is the top of ANOMALY so that
// "most fire" is the same red in both colour modes.
const FIRE: [number, number, number][] = [
  [55, 22, 40],
  [110, 28, 50],
  [170, 36, 48],
  [220, 46, 46],
  [255, 52, 52],
];

// Diverging: MODIS-dominant (orange) ← neutral → VIIRS-dominant (cyan).
const DIVERGE: [number, number, number][] = [
  [255, 120, 40],
  [200, 110, 70],
  [90, 96, 110],
  [60, 150, 200],
  [56, 208, 255],
];

function ramp(stops: [number, number, number][], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const fireRgb = (t: number) => ramp(FIRE, t);
export const divergeRgb = (t: number) => ramp(DIVERGE, (t + 1) / 2);

/** log2(ratio) clamped to ±2, i.e. ¼× … 4× normal. */
export const anomalyT = (ratio: number) => Math.max(-1, Math.min(1, Math.log2(Math.max(ratio, 1e-3)) / 2));
export const anomalyRgb = (ratio: number) => ramp(ANOMALY, (anomalyT(ratio) + 1) / 2);

export const rgbCss = ([r, g, b]: [number, number, number], a = 1) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

export const fireGradientCss = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1]
  .map((t) => rgbCss(fireRgb(t)))
  .join(", ")})`;

export const divergeGradientCss = `linear-gradient(90deg, ${[-1, -0.5, 0, 0.5, 1]
  .map((t) => rgbCss(divergeRgb(t)))
  .join(", ")})`;

export const anomalyGradientCss = `linear-gradient(90deg, ${[0.25, 0.5, 1, 2, 4]
  .map((r) => rgbCss(anomalyRgb(r)))
  .join(", ")})`;

/** Log scaling so a handful of very active cells do not wash out the rest. */
export const logNorm = (v: number, max: number) => (max > 0 ? Math.log1p(Math.max(0, v)) / Math.log1p(max) : 0);
