import { useEffect, useRef } from "react";
import {
  ArcType,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
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
import { cellRatio, fmt, fmtRatio, inRange } from "../data";
import { anomalyRgb, divergeRgb, fireRgb, logNorm, SENSOR_COLORS } from "../colors";
import type { Basemap, ColorMode, Dataset, Layer, PickedPoint, PointSet, Range, Sensor } from "../types";

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
  basemap: Basemap;
  /** per-cell totals over the range for the active sensor view */
  values: Float64Array;
  /** per-cell normal over the range (harmonized baseline median) */
  medians: Float64Array;
  points: PointSet | null;
  selectedCell: number | null;
  /** phone layout: fly to a selected cell so it ends up above the bottom sheet */
  centerOnSelect?: boolean;
  onSelectCell: (i: number | null) => void;
  onSelectPoint: (p: PickedPoint | null) => void;
  onHover: (h: Hover | null) => void;
  onReady?: (v: Viewer | null) => void;
}

const MAX_COLUMN_M = 70000;
const SENSOR_LABEL: Record<Sensor, string> = {
  modis: "MODIS detections",
  viirs: "VIIRS detections",
  harm: "harmonized detections",
  diff: "VIIRS − MODIS (raw)",
  convdiff: "converted MODIS − VIIRS",
};

function basemapProvider(b: Basemap) {
  if (b === "satellite")
    return new UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 18,
      credit: new Credit("Imagery © Esri, Maxar, Earthstar Geographics"),
    });
  if (b === "bluemarble")
    return new UrlTemplateImageryProvider({
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
      maximumLevel: 8,
      credit: new Credit("NASA Blue Marble · GIBS / Worldview"),
    });
  return new UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 16,
    credit: new Credit("Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors"),
  });
}

function regionRect(data: Dataset, region: string): Rectangle {
  const f = data.aoi.features.find((x) => x.properties.name === region);
  if (!f) return Rectangle.fromDegrees(...data.meta.bbox);
  let w = 180, s = 90, e = -180, n = -90;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  visit(f.geometry.coordinates);
  return Rectangle.fromDegrees(w, s, e, n);
}

function flyToRect(viewer: Viewer, rect: Rectangle, duration: number) {
  if (rect.width > Math.PI || rect.height > Math.PI / 2) {
    // continental / world extent: look straight down from far away instead of an oblique regional view
    const c0 = Rectangle.center(rect);
    viewer.camera.flyTo({ destination: Cartesian3.fromRadians(c0.longitude, Math.max(c0.latitude, 0.25), 2.4e7), duration });
    return;
  }
  const c = Rectangle.center(rect);
  const center = Cartesian3.fromRadians(c.longitude, c.latitude);
  const r = Cartesian3.distance(center, Cartesian3.fromRadians(rect.west, rect.south));
  viewer.camera.flyToBoundingSphere(new BoundingSphere(center, r), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-60), r * 2.9),
    duration,
  });
}

export default function Globe(props: Props) {
  const { data, sensor, colorMode, layer, range, region, basemap, values, medians, points, selectedCell } = props;
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const gridRef = useRef<Primitive | null>(null);
  const pointsRef = useRef<PointPrimitiveCollection | null>(null);
  const heightsRef = useRef<Float64Array>(new Float64Array(0));
  const highlightRef = useRef<Entity | null>(null);
  const aoiRef = useRef<CustomDataSource | null>(null);
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
    scene.screenSpaceCameraController.minimumZoomDistance = 4000;
    scene.screenSpaceCameraController.maximumZoomDistance = 3.2e7;
    viewerRef.current = viewer;
    cb.current.onReady?.(viewer);

    const aoi = new CustomDataSource("aoi");
    viewer.dataSources.add(aoi);
    aoiRef.current = aoi;

    const pts = scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    pointsRef.current = pts;

    flyToRect(viewer, regionRect(cb.current.data, cb.current.region), 0);

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    const describe = (picked: { id?: unknown } | undefined) => {
      const id = picked?.id as { kind?: string; i?: number } | undefined;
      return id && typeof id.i === "number" ? id : null;
    };
    handler.setInputAction((e: { position: Cartesian2 }) => {
      const id = describe(scene.pick(e.position));
      const p = cb.current;
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
        scene.canvas.style.cursor = id ? "pointer" : "";
        if (id?.kind === "cell") {
          const c = p.data.cells;
          const v = p.values[id.i!];
          const r = c.regions[c.region[id.i!]] ?? "Outside AOI";
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

  // ---- region outlines + camera
  useEffect(() => {
    const v = viewerRef.current;
    const ds = aoiRef.current;
    if (!v || !ds) return;
    ds.entities.removeAll();
    for (const f of data.aoi.features) {
      const active = region === "All" || region === f.properties.name;
      const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
      for (const poly of polys) {
        const ring = poly[0];
        ds.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights(ring.flatMap(([x, y]) => [x, y, 150])),
            width: active ? 2 : 1,
            arcType: ArcType.GEODESIC,
            material: Color.WHITE.withAlpha(active ? 0.75 : 0.22),
          },
        });
      }
    }
  }, [data, region]);

  const firstFly = useRef(true);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (firstFly.current) {
      firstFly.current = false;
      return;
    }
    flyToRect(v, regionRect(data, region), 1.6);
  }, [data, region]);

  // ---- 5 km grid columns
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const scene = v.scene;
    const c = data.cells;
    const N = c.id.length;
    const rIdx = region === "All" ? -2 : c.regions.indexOf(region);
    const anomaly = sensor === "harm" && colorMode === "anomaly";
    const heights = new Float64Array(N);
    const keep = new Uint8Array(N);
    // coarse overview cells are tens of km wide: taller columns keep the same visual proportions
    const zScale = Math.min(6, Math.max(1, Math.sqrt(data.meta.cell_size_m / 5000)));
    let max = 0;
    for (let i = 0; i < N; i++) {
      if (rIdx !== -2 && c.region[i] !== rIdx) continue;
      // in anomaly mode, normally-active cells that stayed quiet are shown as flat blue tiles
      if (values[i] !== 0 || (anomaly && medians[i] >= 1)) keep[i] = 1;
      max = Math.max(max, Math.abs(values[i]));
    }
    heightsRef.current = heights;

    const old = gridRef.current;
    const removeOld = () => {
      if (old && !old.isDestroyed() && !v.isDestroyed()) scene.primitives.remove(old);
    };
    if (layer !== "grid" || !keep.some((x) => x === 1)) {
      removeOld();
      gridRef.current = null;
      return;
    }

    const instances: GeometryInstance[] = [];
    for (let i = 0; i < N; i++) {
      if (!keep[i]) continue;
      const val = values[i];
      const t = logNorm(Math.abs(val), max);
      heights[i] = (val === 0 ? 250 : 600 + t * MAX_COLUMN_M) * zScale;
      const rgb = anomaly
        ? anomalyRgb(cellRatio(val, medians[i]))
        : sensor === "diff"
          ? divergeRgb(Math.sign(val) * t)
          : sensor === "convdiff"
          ? divergeRgb(-Math.sign(val) * t)
          : fireRgb(0.08 + 0.92 * t);
      const pad = (c.e[i] - c.w[i]) * 0.08;
      const padY = (c.n[i] - c.s[i]) * 0.08;
      instances.push(
        new GeometryInstance({
          geometry: new RectangleGeometry({
            rectangle: Rectangle.fromDegrees(c.w[i] + pad, c.s[i] + padY, c.e[i] - pad, c.n[i] - padY),
            height: 0,
            extrudedHeight: heights[i],
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              new Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1),
            ),
          },
          id: { kind: "cell", i },
        }),
      );
    }
    const prim = scene.primitives.add(
      new Primitive({
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
      }),
    ) as Primitive;
    gridRef.current = prim;
    // keep the previous columns on screen until the new primitive has been built by the workers
    const stop = scene.postRender.addEventListener(() => {
      if (prim.isDestroyed() || prim.ready) {
        stop();
        removeOld();
      }
    });
    return () => {
      stop();
      removeOld();
    };
  }, [data, sensor, colorMode, values, medians, region, layer]);

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
      offset: new HeadingPitchRange(cam.heading, Math.min(cam.pitch, CesiumMath.toRadians(-35)), range),
      duration: 0.8,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell]);

  // ---- selected cell highlight
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (highlightRef.current) v.entities.remove(highlightRef.current);
    highlightRef.current = null;
    if (selectedCell === null) return;
    const c = data.cells;
    const h = Math.max(heightsRef.current[selectedCell] || 0, 1500);
    highlightRef.current = v.entities.add({
      rectangle: {
        coordinates: Rectangle.fromDegrees(c.w[selectedCell], c.s[selectedCell], c.e[selectedCell], c.n[selectedCell]),
        height: 0,
        extrudedHeight: h * 1.04 + 400,
        material: Color.WHITE.withAlpha(0.12),
        outline: true,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
      },
    });
  }, [selectedCell, data, values, colorMode, region, layer]);

  // ---- detection points
  useEffect(() => {
    const pts = pointsRef.current;
    if (!pts) return;
    pts.removeAll();
    if (layer !== "points" || !points) return;
    const modis = new Set(data.meta.modis_platforms.map((p) => data.meta.platforms.indexOf(p)));
    const rIdx = region === "All" ? -2 : data.meta.regions.indexOf(region);
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
  }, [points, sensor, layer, region, data, range]);

  return <div ref={container} className="globe" />;
}
