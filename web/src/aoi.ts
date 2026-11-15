// AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
/**
 * "Analyze your area": a user polygon (uploaded or drawn) is matched against the 5 km cells of the
 * loaded dataset and their monthly harmonized counts are summed. Runs entirely in the browser.
 */
import type { Dataset } from "./types";

/** MultiPolygon coordinates in WGS84: polygons → rings (first = outer) → [lon, lat]. */
export type Poly = number[][][][];

type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };

function collect(g: Geometry | null | undefined, out: Poly) {
  if (!g) return;
  if (g.type === "Polygon") out.push(g.coordinates as number[][][]);
  else if (g.type === "MultiPolygon") out.push(...(g.coordinates as number[][][][]));
  else if (g.type === "GeometryCollection") g.geometries?.forEach((x) => collect(x, out));
}

export function polyFromGeoJSON(gj: unknown): Poly {
  const out: Poly = [];
  const walk = (o: { type?: string; features?: unknown[]; geometry?: Geometry } | unknown[]) => {
    if (Array.isArray(o)) return o.forEach((x) => walk(x as never));
    if (o.type === "FeatureCollection") o.features?.forEach((f) => walk(f as never));
    else if (o.type === "Feature") collect(o.geometry, out);
    else collect(o as Geometry, out);
  };
  walk(gj as never);
  return out;
}

export function polyFromKML(text: string): Poly {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const ring = (el: Element | null) =>
    (el?.textContent ?? "")
      .trim()
      .split(/\s+/)
      .map((t) => t.split(",").map(Number).slice(0, 2))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
  return [...doc.getElementsByTagNameNS("*", "Polygon")]
    .map((p) => [
      ring(p.querySelector("outerBoundaryIs coordinates")),
      ...[...p.querySelectorAll("innerBoundaryIs coordinates")].map(ring),
    ])
    .filter((r) => r[0].length >= 3);
}

/** GeoJSON / KML / zipped Shapefile → polygon. Throws with a readable message. */
export async function readAreaFile(file: File): Promise<Poly> {
  const name = file.name.toLowerCase();
  let poly: Poly;
  if (name.endsWith(".zip") || name.endsWith(".shp")) {
    const { default: shp } = await import("shpjs");
    poly = polyFromGeoJSON(await shp(await file.arrayBuffer()));
  } else if (name.endsWith(".kml")) poly = polyFromKML(await file.text());
  else poly = polyFromGeoJSON(JSON.parse(await file.text()));
  if (!poly.length) throw new Error("No polygon found in the file (points and lines are not areas).");
  const outside = poly.flat(2).some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90);
  if (outside) throw new Error("Coordinates are not longitude / latitude (WGS84). Re-export the file in EPSG:4326.");
  return poly;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPoly(x: number, y: number, poly: Poly): boolean {
  return poly.some((rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));
}

export function polyBbox(poly: Poly): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of poly.flat(2)) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

/** Geodesic area in km² (spherical approximation). */
export function polyAreaKm2(poly: Poly): number {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  const ringArea = (r: number[][]) => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i];
      const [x2, y2] = r[(i + 1) % r.length];
      a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    return Math.abs((a * R * R) / 2);
  };
  return poly.reduce((s, rings) => s + ringArea(rings[0]) - rings.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
}

export interface AreaResult {
  /** cell indices whose centre lies in the polygon */
  cells: number[];
  areaKm2: number;
  cellKm2: number;
  /** share of the polygon's bbox outside the dataset's bbox (0 = fully covered) */
  outsideShare: number;
  harm: number[];
  conv: number[];
  modis: number[];
  viirs: number[];
  /** baseline mean per calendar month, summed over the cells */
  normal12: number[];
}

export function analyzeArea(ds: Dataset, poly: Poly): AreaResult {
  const { cells, monthly, meta } = ds;
  const [pw, ps, pe, pn] = polyBbox(poly);
  const mask = new Uint8Array(cells.id.length);
  const picked: number[] = [];
  for (let i = 0; i < cells.id.length; i++) {
    const x = (cells.w[i] + cells.e[i]) / 2;
    const y = (cells.s[i] + cells.n[i]) / 2;
    if (x < pw || x > pe || y < ps || y > pn || !inPoly(x, y, poly)) continue;
    mask[i] = 1;
    picked.push(i);
  }
  const n = monthly.months.length;
  const sumLayer = (sp?: { c: number[]; k: number[]; v: number[] }) => {
    const out = new Array<number>(n).fill(0);
    if (sp) for (let j = 0; j < sp.c.length; j++) if (mask[sp.c[j]]) out[sp.k[j]] += sp.v[j];
    return out;
  };
  const normal12 = new Array<number>(12).fill(0);
  for (const i of picked) for (let m = 0; m < 12; m++) normal12[m] += ds.normalDense[i * 12 + m];

  const [bw, bs, be, bn] = meta.bbox;
  const ix = Math.max(0, Math.min(pe, be) - Math.max(pw, bw));
  const iy = Math.max(0, Math.min(pn, bn) - Math.max(ps, bs));
  const pArea = Math.max((pe - pw) * (pn - ps), 1e-12);
  return {
    cells: picked,
    areaKm2: polyAreaKm2(poly),
    cellKm2: (cells.size_m / 1000) ** 2,
    outsideShare: 1 - Math.min(1, (ix * iy) / pArea),
    harm: sumLayer(monthly.harm ?? monthly.viirs),
    conv: sumLayer(monthly.conv),
    modis: sumLayer(monthly.modis),
    viirs: sumLayer(monthly.viirs),
    normal12,
  };
}

/** Closed GeoJSON of the polygon, for download. */
export function polyToGeoJSON(poly: Poly, props: Record<string, unknown> = {}) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: props, geometry: { type: "MultiPolygon", coordinates: poly } }],
  };
}
