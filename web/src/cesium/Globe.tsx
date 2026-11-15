// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useRef, type MutableRefObject } from "react";
import {
  ArcType,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  Credit,
  CustomDataSource,
  Entity,
  GeometryInstance,
  HeadingPitchRange,
  Math as CesiumMath,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  Primitive,
  Rectangle,
  RectangleGeometry,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import { cellInPlace, cellRatio, fmt, fmtRatio, inRange, placeKey } from "../data";
import { anomalyRgb, divergeRgb, fireRgb, logNorm, robustMax, SENSOR_COLORS } from "../colors";
import type { Basemap, ColorMode, Dataset, Layer, PickedPoint, PointSet, Range, Sensor } from "../types";
import { polyBbox, type Poly } from "../aoi";

export interface Hover {
  x: number;
  y: number;
  title: string;
  value: string;
}

interface Props {
  data: Dataset;
  sensor: Sensor;
  colorMode: ColorMode;
  layer: Layer;
  range: Range;
  region: string;
  /** Country within a UN sub-region (world dual-hierarchy); "All" = whole region. */
  country?: string;
  basemap: Basemap;
  /** per-cell totals over the range for the active sensor view */
  values: Float64Array;
  /** Shared colour ceiling for count mode (same red = same detections for MODIS / VIIRS / harm). */
  countMax?: number;
  /** per-cell normal over the range (harmonized baseline median) */
  medians: Float64Array;
  points: PointSet | null;
  selectedCell: number | null;
  /** phone layout: fly to a selected cell so it ends up above the bottom sheet */
  centerOnSelect?: boolean;
  /** "Analyze your area": the user's polygon, the vertices being drawn, and the drawing mode */
  area?: Poly | null;
  draft?: number[][];
  drawMode?: boolean;
  onDrawPoint?: (lonLat: [number, number]) => void;
  onSelectCell: (i: number | null) => void;
  onSelectPoint: (p: PickedPoint | null) => void;
  onHover: (h: Hover | null) => void;
  onReady?: (v: Viewer | null) => void;
  /** True while the choropleth primitive is being built (world grid can take a few seconds). */
  onPaint?: (painting: boolean) => void;
  /** When true, the next data/region change does not fly the camera (zoom LOD dataset swaps). */
  skipNextFitRef?: MutableRefObject<boolean>;
}

const SENSOR_LABEL: Record<Sensor, string> = {
  modis: "MODIS detections",
  viirs: "VIIRS detections",
  harm: "harmonized detections",
  diff: "VIIRS − MODIS (raw)",
  convdiff: "converted MODIS − VIIRS",
};

function basemapProvider(b: Basemap) {
  // Short credits only — full FIRMS + basemap list lives in the Data attribution popover.
  if (b === "satellite")
    return new UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 18,
      credit: new Credit("Esri"),
    });
  if (b === "bluemarble")
    return new UrlTemplateImageryProvider({
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
      maximumLevel: 8,
      credit: new Credit("NASA GIBS"),
    });
  return new UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 16,
    credit: new Credit("Esri"),
  });
}

/**
 * Smallest longitude arc that covers all points. Regions that cross the antimeridian
 * (NZ, Melanesia, Alaska / Northern America) must NOT use naive min/max lon — that
 * yields a ~360° box and the camera never reaches the data.
 */
function tightLonSpan(lons: number[]): [number, number] {
  if (!lons.length) return [-180, 180];
  const xs = [...new Set(lons.map((l) => ((((l + 180) % 360) + 360) % 360) - 180))].sort((a, b) => a - b);
  if (xs.length === 1) return [xs[0] - 2, xs[0] + 2];
  let maxGap = 0;
  let after = xs.length - 1;
  for (let i = 0; i < xs.length - 1; i++) {
    const g = xs[i + 1] - xs[i];
    if (g > maxGap) {
      maxGap = g;
      after = i;
    }
  }
  const wrap = xs[0] + 360 - xs[xs.length - 1];
  if (wrap >= maxGap) return [xs[0], xs[xs.length - 1]];
  // Cesium: east < west means the rectangle crosses the antimeridian.
  return [xs[after + 1], xs[after]];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

/**
 * Frame the core of a region. Overseas outliers (e.g. Caribbean cells tagged Western Europe)
 * are dropped by distance from the ECEF median; nearby secondary landmasses (NZ next to
 * Australia) stay within 2× the 90th-percentile radius.
 */
function regionCoreRect(data: Dataset, region: string, country = "All"): Rectangle {
  if (region === "All" && country === "All") return Rectangle.fromDegrees(...data.meta.bbox);

  const place = placeKey(region, country);
  const c = data.cells;
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i < c.id.length; i++) {
    if (!cellInPlace(c, i, region, country)) continue;
    if (c.e[i] < c.w[i]) continue;
    lons.push((c.w[i] + c.e[i]) / 2);
    lats.push((c.s[i] + c.n[i]) / 2);
  }
  if (lons.length < 3) {
    const f = data.aoi.features.find((x) => x.properties.name === place);
    if (!f) return Rectangle.fromDegrees(...data.meta.bbox);
    const visit = (node: unknown): void => {
      if (Array.isArray(node) && typeof node[0] === "number") {
        lons.push((node as number[])[0]);
        lats.push((node as number[])[1]);
      } else if (Array.isArray(node)) node.forEach(visit);
    };
    visit(f.geometry.coordinates);
  }
  if (!lons.length) return Rectangle.fromDegrees(...data.meta.bbox);

  const positions = lons.map((lon, i) => Cartesian3.fromDegrees(lon, lats[i]));
  // Component-wise median in ECEF ≈ geographic median for compact regions.
  const xs = positions.map((p) => p.x).sort((a, b) => a - b);
  const ys = positions.map((p) => p.y).sort((a, b) => a - b);
  const zs = positions.map((p) => p.z).sort((a, b) => a - b);
  const med = new Cartesian3(percentile(xs, 0.5), percentile(ys, 0.5), percentile(zs, 0.5));
  const dist = positions.map((p) => Cartesian3.distance(p, med));
  const dSorted = [...dist].sort((a, b) => a - b);
  const r90 = percentile(dSorted, 0.9) || 1;
  const maxR = r90 * 2;
  const keepLon: number[] = [];
  const keepLat: number[] = [];
  for (let i = 0; i < lons.length; i++) {
    if (dist[i] <= maxR) {
      keepLon.push(lons[i]);
      keepLat.push(lats[i]);
    }
  }
  if (keepLon.length < 3) {
    keepLon.push(...lons);
    keepLat.push(...lats);
  }

  const [west0, east0] = tightLonSpan(keepLon);
  let south = Math.min(...keepLat);
  let north = Math.max(...keepLat);
  let west = west0;
  let east = east0;
  // Continuous span for padding (unwrap if crossing).
  const span = east >= west ? east - west : 360 - (west - east);
  const latSpan = Math.max(0.1, north - south);
  const minLon = 6;
  const minLat = 4;
  if (span < minLon) {
    const c0 = east >= west ? (west + east) / 2 : west + span / 2;
    west = c0 - minLon / 2;
    east = c0 + minLon / 2;
  }
  if (latSpan < minLat) {
    const m = (north + south) / 2;
    south = m - minLat / 2;
    north = m + minLat / 2;
  }
  const padLon = Math.max(0.6, (east >= west ? east - west : 360 - (west - east)) * 0.06);
  const padLat = Math.max(0.6, (north - south) * 0.06);
  if (east >= west) {
    west -= padLon;
    east += padLon;
  } else {
    west -= padLon;
    east += padLon;
  }
  south = Math.max(-85, south - padLat);
  north = Math.min(85, north + padLat);
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return Rectangle.fromDegrees(wrap(west), south, wrap(east), north);
}

function flyToRect(viewer: Viewer, rect: Rectangle, duration: number) {
  const worldish = rect.width > Math.PI * 0.95 || rect.height > Math.PI / 2;
  if (worldish) {
    const c0 = Rectangle.center(rect);
    viewer.camera.flyTo({
      destination: Cartesian3.fromRadians(c0.longitude, Math.max(c0.latitude, 0.15), 2.4e7),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
      duration,
    });
    return;
  }
  // Top-down onto the core rectangle (closer than the old oblique sphere fit).
  viewer.camera.flyTo({
    destination: rect,
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
    duration,
  });
}

/** Prefer the core cell bbox; used for region / country changes and initial view. */
function regionRect(data: Dataset, region: string, country = "All"): Rectangle {
  return regionCoreRect(data, region, country);
}

/** Soften over-simplified country rings (Chaikin) so borders look less zig-zag. */
function smoothRing(ring: number[][], passes = 2): number[][] {
  if (ring.length < 4) return ring;
  let pts = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice();
  for (let p = 0; p < passes; p++) {
    const next: number[][] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = next;
  }
  pts.push(pts[0]);
  return pts;
}

export default function Globe(props: Props) {
  const { data, sensor, colorMode, layer, range, region, basemap, values, countMax, medians, points, selectedCell } = props;
  const country = props.country ?? "All";
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const gridRef = useRef<Primitive | null>(null);
  const pointsRef = useRef<PointPrimitiveCollection | null>(null);
  const heightsRef = useRef<Float64Array>(new Float64Array(0));
  const highlightRef = useRef<Entity | null>(null);
  const aoiRef = useRef<CustomDataSource | null>(null);
  const areaRef = useRef<CustomDataSource | null>(null);
  const cb = useRef(props);
  cb.current = props;

  // ---- viewer lifecycle
  useEffect(() => {
    const viewer = new Viewer(container.current!, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      // 4× MSAA costs too much fill rate on phone GPUs
      msaaSamples: window.matchMedia("(pointer: coarse)").matches ? 1 : 4,
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
    const scene = viewer.scene;
    scene.globe.baseColor = Color.fromCssColorString("#070a10");
    scene.backgroundColor = Color.fromCssColorString("#03050a");
    scene.globe.showGroundAtmosphere = true;
    scene.globe.depthTestAgainstTerrain = false;
    const ctrl = scene.screenSpaceCameraController;
    ctrl.minimumZoomDistance = 1200;
    ctrl.maximumZoomDistance = 3.2e7;
    // Prefer map-like control: less tilt, keep the globe upright.
    ctrl.inertiaSpin = 0.7;
    ctrl.inertiaTranslate = 0.7;
    ctrl.inertiaZoom = 0.6;
    // Clamp pitch so the view cannot tip into an unreadable oblique angle.
    const clampPitch = () => {
      const cam = viewer.camera;
      const minP = CesiumMath.toRadians(-89.9);
      const maxP = CesiumMath.toRadians(-25);
      if (cam.pitch > maxP || cam.pitch < minP) {
        const p = Math.min(maxP, Math.max(minP, cam.pitch));
        cam.setView({
          destination: cam.positionWC,
          orientation: { heading: cam.heading, pitch: p, roll: 0 },
        });
      }
      if (Math.abs(cam.roll) > 1e-3) {
        cam.setView({
          destination: cam.positionWC,
          orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 },
        });
      }
    };
    const removeClamp = scene.postRender.addEventListener(clampPitch);
    viewerRef.current = viewer;
    cb.current.onReady?.(viewer);

    const aoi = new CustomDataSource("aoi");
    viewer.dataSources.add(aoi);
    aoiRef.current = aoi;
    const userArea = new CustomDataSource("user-area");
    viewer.dataSources.add(userArea);
    areaRef.current = userArea;

    const pts = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    pointsRef.current = pts;

    flyToRect(viewer, regionRect(cb.current.data, cb.current.region, cb.current.country ?? "All"), 0);

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    const describe = (picked: { id?: unknown } | undefined) => {
      const id = picked?.id as { kind?: string; i?: number } | undefined;
      return id && typeof id.i === "number" ? id : null;
    };
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const p = cb.current;
      if (p.drawMode) {
        const pos = viewer.camera.pickEllipsoid(e.position, scene.globe.ellipsoid);
        if (pos) {
          const c = Cartographic.fromCartesian(pos);
          p.onDrawPoint?.([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
        }
        return;
      }
      const id = describe(scene.pick(e.position));
      if (id?.kind === "cell") {
        p.onSelectCell(id.i!);
        p.onSelectPoint(null);
      } else if (id?.kind === "pt" && p.points) {
        const k = id.i!;
        const ps = p.points;
        const d = new Date(Date.UTC(ps.year[k], 0, ps.doy[k]));
        p.onSelectPoint({
          lon: ps.lon[k],
          lat: ps.lat[k],
          frp: ps.frp[k],
          platform: p.data.meta.platforms[ps.p[k]],
          date: d.toISOString().slice(0, 10),
          night: ps.night[k] === 1,
        });
      } else {
        p.onSelectCell(null);
        p.onSelectPoint(null);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    let raf = 0;
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const id = describe(scene.pick(e.endPosition));
        const p = cb.current;
        scene.canvas.style.cursor = p.drawMode ? "crosshair" : id ? "pointer" : "";
        if (id?.kind === "cell") {
          const c = p.data.cells;
          const v = p.values[id.i!];
          const i = id.i!;
          const r =
            (c.countries && c.country && c.country[i] >= 0 ? c.countries[c.country[i]] : null) ??
            c.regions[c.region[i]] ??
            "Outside AOI";
          const isDiff = p.sensor === "diff" || p.sensor === "convdiff";
          const sign = isDiff && v > 0 ? "+" : "";
          const anomaly = p.sensor === "harm" && p.colorMode === "anomaly";
          p.onHover({
            x: e.endPosition.x,
            y: e.endPosition.y,
            title: `${r} · ${p.data.meta.cell_size_m / 1000} km cell`,
            value: anomaly
              ? `${fmt(v)} detection${v === 1 ? "" : "s"} · normal ${fmt(p.medians[id.i!])} · ${fmtRatio(cellRatio(v, p.medians[id.i!]))}`
              : `${sign}${fmt(v)} ${SENSOR_LABEL[p.sensor]}`,
          });
        } else if (id?.kind === "pt" && p.points) {
          const k = id.i!;
          p.onHover({
            x: e.endPosition.x,
            y: e.endPosition.y,
            title: p.data.meta.platforms[p.points.p[k]],
            value: `FRP ${p.points.frp[k].toFixed(1)} MW`,
          });
        } else p.onHover(null);
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    const onLeave = () => cb.current.onHover(null);
    scene.canvas.addEventListener("mouseleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      removeClamp();
      scene.canvas.removeEventListener("mouseleave", onLeave);
      handler.destroy();
      cb.current.onReady?.(null);
      viewer.destroy();
      viewerRef.current = null;
      gridRef.current = null;
      pointsRef.current = null;
      highlightRef.current = null;
    };
  }, []);

  // ---- basemap
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.imageryLayers.removeAll();
    v.imageryLayers.addImageryProvider(basemapProvider(basemap));
  }, [basemap]);

  // ---- region / country outlines
  useEffect(() => {
    const v = viewerRef.current;
    const ds = aoiRef.current;
    if (!v || !ds) return;
    ds.entities.removeAll();
    const dual = data.aoi.features.some((f) => f.properties.level === "country" || f.properties.level === "super");
    for (const f of data.aoi.features) {
      const level = f.properties.level ?? "region";
      const name = f.properties.name;
      const parent = f.properties.parent;
      let active = false;
      let show = true;
      if (!dual) {
        active = region === "All" || region === name;
      } else if (region === "All") {
        if (level !== "super") continue;
        active = true;
      } else if (country === "All") {
        if (level === "country" && parent === region) active = true;
        else if (level === "super" && name === region) active = false;
        else continue;
      } else {
        if (level !== "country" || parent !== region) continue;
        active = name === country;
        show = true;
      }
      if (!show) continue;
      const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
      for (const poly of polys) {
        const ring = smoothRing(poly[0]);
        if (ring.length < 2) continue;
        ds.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights(ring.flatMap(([x, y]) => [x, y, 150])),
            width: active ? (country !== "All" ? 2.2 : 1.5) : 0.8,
            arcType: ArcType.GEODESIC,
            material: Color.WHITE.withAlpha(active ? 0.55 : 0.16),
          },
        });
      }
    }
  }, [data, region, country]);

  // ---- user area (analyze your area): finished polygon + vertices being drawn
  const { area, draft, drawMode } = props;
  useEffect(() => {
    const v = viewerRef.current;
    const ds = areaRef.current;
    if (!v || !ds) return;
    ds.entities.removeAll();
    v.scene.canvas.style.cursor = drawMode ? "crosshair" : "";
    const accent = Color.fromCssColorString("#38d0ff");
    for (const rings of area ?? []) {
      for (const ring of rings) {
        ds.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights([...ring, ring[0]].flatMap(([x, y]) => [x, y, 300])),
            width: 3,
            arcType: ArcType.GEODESIC,
            material: accent,
            depthFailMaterial: accent.withAlpha(0.7),
          },
        });
      }
    }
    if (draft?.length) {
      for (const [x, y] of draft)
        ds.entities.add({ position: Cartesian3.fromDegrees(x, y, 300), point: { pixelSize: 9, color: accent, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      if (draft.length > 1)
        ds.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights([...draft, ...(draft.length > 2 ? [draft[0]] : [])].flatMap(([x, y]) => [x, y, 300])),
            width: 2,
            arcType: ArcType.GEODESIC,
            material: accent.withAlpha(0.8),
            depthFailMaterial: accent.withAlpha(0.6),
          },
        });
    }
  }, [area, draft, drawMode]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !area?.length) return;
    const [w, s, e, n] = polyBbox(area);
    const pad = Math.max(e - w, n - s) * 0.6 + 0.1;
    // phone: the half-height sheet covers the lower map, so frame the area higher up
    const below = props.centerOnSelect ? (n - s) * 1.6 + pad : pad;
    flyToRect(v, Rectangle.fromDegrees(w - pad, s - below, e + pad, n + pad), 1.4);
  }, [area]);

  const firstFly = useRef(true);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (firstFly.current) {
      firstFly.current = false;
      return;
    }
    if (props.skipNextFitRef?.current) {
      props.skipNextFitRef.current = false;
      return;
    }
    flyToRect(v, regionRect(data, region, country), 1.6);
  }, [data, region, country, props.skipNextFitRef]);

  // ---- flat 2D coloured cells (choropleth) — no extruded columns
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const scene = v.scene;
    const paint = (on: boolean) => cb.current.onPaint?.(on);
    const c = data.cells;
    const N = c.id.length;
    const anomaly = sensor === "harm" && colorMode === "anomaly";
    const heights = new Float64Array(N);
    const keep = new Uint8Array(N);
    const absVals: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!cellInPlace(c, i, region, country)) continue;
      // in anomaly mode, normally-active cells that stayed quiet are shown as flat blue tiles
      if (values[i] !== 0 || (anomaly && medians[i] >= 1)) keep[i] = 1;
      if (values[i] !== 0) absVals.push(Math.abs(values[i]));
    }
    const localMax = robustMax(absVals, 0.95);
    const max = !anomaly && sensor !== "diff" && sensor !== "convdiff" && countMax && countMax > 0 ? countMax : localMax;
    heightsRef.current = heights;

    const old = gridRef.current;
    const removeOld = () => {
      if (old && !old.isDestroyed() && !v.isDestroyed()) scene.primitives.remove(old);
    };
    if (layer !== "grid" || !keep.some((x) => x === 1)) {
      removeOld();
      gridRef.current = null;
      paint(false);
      return;
    }

    // Show the map spinner for one frame before the heavy instance loop (world 25/50 km).
    paint(true);
    let stop: (() => void) | undefined;
    let cancelled = false;
    let added: Primitive | null = null;
    const timer = window.setTimeout(() => {
      if (cancelled || v.isDestroyed()) return;
      const instances: GeometryInstance[] = [];
      const cellH = Math.max(80, data.meta.cell_size_m * 0.02);
      for (let i = 0; i < N; i++) {
        if (!keep[i]) continue;
        const val = values[i];
        const t = logNorm(Math.abs(val), max);
        heights[i] = cellH;
        const rgb = anomaly
          ? anomalyRgb(cellRatio(val, medians[i]))
          : sensor === "diff"
            ? divergeRgb(Math.sign(val) * t)
            : sensor === "convdiff"
            ? divergeRgb(-Math.sign(val) * t)
            : fireRgb(0.08 + 0.92 * t);
        // Quiet anomaly cells stay more transparent so active fire stands out.
        const alpha = anomaly && val === 0 ? 0.45 : 0.88;
        const padY = (c.n[i] - c.s[i]) * 0.04;
        const south = c.s[i] + padY;
        const north = c.n[i] - padY;
        const colorAttr = ColorGeometryInstanceAttribute.fromColor(new Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha));
        // Cells that cross the antimeridian must be split; a single east<west rectangle draws a whole world strip.
        const parts: [number, number][] =
          c.e[i] >= c.w[i]
            ? [[c.w[i], c.e[i]]]
            : [
                [c.w[i], 180],
                [-180, c.e[i]],
              ];
        for (const [west, east] of parts) {
          const pad = Math.max(0, (east - west) * 0.04);
          if (east - west <= pad * 2 + 1e-6) continue;
          instances.push(
            new GeometryInstance({
              geometry: new RectangleGeometry({
                rectangle: Rectangle.fromDegrees(west + pad, south, east - pad, north),
                height: cellH,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              attributes: { color: colorAttr },
              id: { kind: "cell", i },
            }),
          );
        }
      }
      if (cancelled || v.isDestroyed()) return;
      const prim = scene.primitives.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ translucent: true, closed: false, flat: true }),
          asynchronous: true,
        }),
      ) as Primitive;
      added = prim;
      gridRef.current = prim;
      // keep the previous layer on screen until the new primitive has been built by the workers
      stop = scene.postRender.addEventListener(() => {
        if (prim.isDestroyed() || prim.ready) {
          stop?.();
          removeOld();
          paint(false);
        }
      });
    }, 40);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop?.();
      paint(false);
      if (added && !added.isDestroyed() && !v.isDestroyed()) {
        scene.primitives.remove(added);
        gridRef.current = old;
      }
    };
  }, [data, sensor, colorMode, values, countMax, medians, region, country, layer]);

  // ---- phone: bring the selected cell into the upper, uncovered part of the screen
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || selectedCell === null || !props.centerOnSelect) return;
    const c = data.cells;
    const lon = (c.w[selectedCell] + c.e[selectedCell]) / 2;
    const lat = (c.n[selectedCell] + c.s[selectedCell]) / 2;
    const cam = v.camera;
    const range = Math.min(Math.max(Cartesian3.distance(cam.positionWC, Cartesian3.fromDegrees(lon, lat)), 60e3), 900e3);
    // aim at a point behind the cell (along the view heading): the cell then sits above the screen centre
    const back = (range * 0.3) / 111_000;
    const aimLat = lat - Math.cos(cam.heading) * back;
    const aimLon = lon - (Math.sin(cam.heading) * back) / Math.cos(CesiumMath.toRadians(lat));
    cam.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(aimLon, aimLat), 1), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-80), range),
      duration: 0.8,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell]);

  // ---- selected cell highlight (flat outline)
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (highlightRef.current) v.entities.remove(highlightRef.current);
    highlightRef.current = null;
    if (selectedCell === null) return;
    const c = data.cells;
    const h = Math.max(heightsRef.current[selectedCell] || 0, 100) + 40;
    highlightRef.current = v.entities.add({
      rectangle: {
        coordinates: Rectangle.fromDegrees(c.w[selectedCell], c.s[selectedCell], c.e[selectedCell], c.n[selectedCell]),
        height: h,
        material: Color.WHITE.withAlpha(0.15),
        outline: true,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
      },
    });
  }, [selectedCell, data, values, colorMode, region, country, layer]);

  // ---- detection points
  useEffect(() => {
    const pts = pointsRef.current;
    if (!pts) return;
    pts.removeAll();
    if (layer !== "points" || !points) return;
    const modis = new Set(data.meta.modis_platforms.map((p) => data.meta.platforms.indexOf(p)));
    // detail windows tag points with the country/region index in meta.regions
    const place = placeKey(region, country);
    const rIdx = place === "All" ? -2 : data.meta.regions.indexOf(place);
    const cM = Color.fromCssColorString(SENSOR_COLORS.modis).withAlpha(0.85);
    const cV = Color.fromCssColorString(SENSOR_COLORS.viirs).withAlpha(0.85);
    const scale = new NearFarScalar(1.5e5, 1.8, 3.5e6, 0.6);
    for (let k = 0; k < points.lon.length; k++) {
      if (!inRange(range, points.k[k])) continue;
      if (rIdx !== -2 && points.r[k] !== rIdx) continue;
      const isModis = modis.has(points.p[k]);
      if (sensor === "modis" && !isModis) continue;
      if (sensor === "viirs" && isModis) continue;
      pts.add({
        position: Cartesian3.fromDegrees(points.lon[k], points.lat[k], 50),
        pixelSize: 2.5 + Math.min(8, Math.sqrt(points.frp[k]) * 0.55),
        color: isModis ? cM : cV,
        scaleByDistance: scale,
        id: { kind: "pt", i: k },
      });
    }
  }, [points, sensor, layer, region, country, data, range]);

  return <div ref={container} className="globe" />;
}
