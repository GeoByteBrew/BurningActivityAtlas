import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Viewer } from "cesium";
import Globe, { type Hover } from "./cesium/Globe";
import AboutModal from "./components/AboutModal";
import { CellDetail, PointDetail } from "./components/CellDetail";
import ControlPanel from "./components/ControlPanel";
import DownloadMenu from "./components/DownloadMenu";
import Header, { FlameMark } from "./components/Header";
import InsightPanel from "./components/InsightPanel";
import Legend from "./components/Legend";
import MethodPanel from "./components/MethodPanel";
import Timeline from "./components/Timeline";
import {
  cellRangeMedians,
  cellRangeValues,
  fullRange,
  isFull,
  loadDataset,
  loadIndex,
  loadPoints,
  monthRange,
  rangeLen,
  sum,
  yearOf,
  yearRange,
} from "./data";
import type { Basemap, ColorMode, Dataset, DatasetEntry, Layer, Meta, PickedPoint, Points, PointSet, Range, Sensor } from "./types";

const SEEN_KEY = "baa-about-seen";
const STORY = { region: "Portugal", year: 2025, month: 7 };

/** Move a range by whole years (or by one month when a single month is selected), wrapping around. */
function shift(meta: Meta, r: Range, dir: 1 | -1): Range {
  const n = meta.years.length * 12;
  if (isFull(meta, r)) return yearRange(meta, dir === 1 ? meta.years[0] : meta.years[meta.years.length - 1]);
  const d = (rangeLen(r) === 1 ? 1 : 12) * dir;
  const len = rangeLen(r);
  let start = r.start + d;
  if (start < 0) start = Math.floor((n - len) / 12) * 12 + (r.start % 12);
  if (start + len > n) start = r.start % 12;
  return { start, end: start + len - 1 };
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sensor, setSensor] = useState<Sensor>("modis");
  const [colorMode, setColorMode] = useState<ColorMode>("anomaly");
  const [layer, setLayer] = useState<Layer>("grid");
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [region, setRegion] = useState("All");
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [cell, setCell] = useState<number | null>(null);
  const [point, setPoint] = useState<PickedPoint | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [points, setPoints] = useState<PointSet | null>(null);
  const [loadingPts, setLoadingPts] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [about, setAbout] = useState(() => !localStorage.getItem(SEEN_KEY));
  const [method, setMethod] = useState(false);
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const viewer = useRef<Viewer | null>(null);

  useEffect(() => {
    loadIndex()
      .then((ix) => {
        setDatasets(ix.datasets);
        const wanted = new URLSearchParams(location.search).get("dataset");
        setDatasetId(ix.datasets.find((d) => d.id === wanted)?.id ?? ix.default ?? ix.datasets[0]?.id ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // (re)load when the dataset changes: world overview ↔ regional detail windows
  useEffect(() => {
    if (datasetId === null) return;
    const entry = datasets.find((d) => d.id === datasetId);
    let alive = true;
    setSwitching(true);
    loadDataset(entry?.path ?? "")
      .then((d) => {
        if (!alive) return;
        setCell(null);
        setPoint(null);
        setPoints(null);
        setRegion("All");
        if (d.meta.points === false) setLayer("grid");
        setData((prev) => {
          // keep the selected period when both datasets cover the same years
          if (!prev || prev.meta.years[0] !== d.meta.years[0] || prev.meta.years.length !== d.meta.years.length)
            setRange(yearRange(d.meta, d.meta.years[d.meta.years.length - 1]));
          return d;
        });
        if (d.meta.harmonized) setSensor((s) => (s === "convdiff" && !d.monthly.conv ? "harm" : s === "modis" && !data ? "harm" : s));
        else setColorMode("count");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => alive && setSwitching(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, datasets]);

  const meta = data?.meta;
  const y0 = meta ? yearOf(meta, range.start) : 0;
  const y1 = meta ? yearOf(meta, range.end) : 0;

  // detections for every year the range touches
  useEffect(() => {
    if (!meta || layer !== "points") return;
    let alive = true;
    const ys = meta.years.filter((y) => y >= y0 && y <= y1);
    setLoadingPts(true);
    const dsPath = data?.path ?? "";
    Promise.all(ys.map((y) => loadPoints(dsPath, y).then((p) => ({ y, p }))))
      .then((parts) => {
        if (!alive) return;
        const cat = (k: keyof Points) => ([] as number[]).concat(...parts.map(({ p }) => p[k]));
        const year = parts.flatMap(({ y, p }) => new Array<number>(p.lon.length).fill(y));
        const doy = cat("doy");
        const k = doy.map((d, i) => {
          const y = year[i];
          const month = new Date(Date.UTC(y, 0, d)).getUTCMonth();
          return (y - meta.years[0]) * 12 + month;
        });
        setPoints({
          lon: cat("lon"),
          lat: cat("lat"),
          frp: cat("frp"),
          p: cat("p"),
          doy,
          night: cat("night"),
          r: cat("r"),
          year,
          k,
        });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => alive && setLoadingPts(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, layer, y0, y1]);

  useEffect(() => setHover(null), [layer, sensor, colorMode, range, region]);

  const step = useCallback((dir: 1 | -1) => meta && setRange((r) => shift(meta, r, dir)), [meta]);

  useEffect(() => {
    if (!playing || !meta) return;
    const t = setInterval(
      () =>
        setRange((r) => {
          if (isFull(meta, r)) return yearRange(meta, meta.years[0]);
          const len = rangeLen(r);
          const start = r.start + 12 + len > meta.years.length * 12 ? r.start % 12 : r.start + 12;
          return { start, end: start + len - 1 };
        }),
      1700,
    );
    return () => clearInterval(t);
  }, [playing, meta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (about || method || (e.target as HTMLElement).closest?.("input, textarea, select")) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Escape") {
        setCell(null);
        setPoint(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, about, method]);

  const values = useMemo(() => (data ? cellRangeValues(data, sensor, range) : new Float64Array()), [data, sensor, range]);
  const medians = useMemo(() => (data ? cellRangeMedians(data, range) : new Float64Array()), [data, range]);

  const regionTotals = useMemo(() => {
    if (!data) return {};
    const out: Record<string, number> = {};
    for (const [r, rs] of Object.entries(data.series.regions)) out[r] = rs.harm ? sum(rs.harm) : sum(Object.values(rs.count).map(sum));
    return out;
  }, [data]);

  const legendMax = useMemo(() => {
    if (!data) return 0;
    const c = data.cells;
    const rIdx = region === "All" ? -2 : c.regions.indexOf(region);
    let max = 0;
    for (let i = 0; i < c.id.length; i++) {
      if (rIdx !== -2 && c.region[i] !== rIdx) continue;
      max = Math.max(max, Math.abs(values[i]));
    }
    return max;
  }, [data, values, region]);

  const closeAbout = useCallback(() => {
    localStorage.setItem(SEEN_KEY, "1");
    setAbout(false);
  }, []);

  const chooseRegion = (r: string) => {
    setRegion(r);
    setCell(null);
  };

  const storyReady = !!meta && meta.harmonized && meta.regions.includes(STORY.region) && meta.years.includes(STORY.year);
  const playStory = () => {
    if (!meta || !storyReady) return;
    setPlaying(false);
    setAbout(false);
    setMethod(false);
    setCell(null);
    setPoint(null);
    setSensor("harm");
    setColorMode("anomaly");
    setLayer("grid");
    setRegion(STORY.region);
    setRange(monthRange(meta, STORY.year, STORY.month));
  };

  if (error)
    return (
      <div className="splash">
        <FlameMark size={48} />
        <h2>Could not load the data</h2>
        <p className="mono">{error}</p>
        <p>
          Run <code>.venv/bin/python scripts/07_export_web.py</code> in the project folder, then reload.
        </p>
      </div>
    );

  if (!data || !meta)
    return (
      <div className="splash">
        <FlameMark size={48} />
        <div className="loader" />
        <p>Loading fire records…</p>
      </div>
    );

  return (
    <div className="app">
      <Globe
        data={data}
        sensor={sensor}
        colorMode={colorMode}
        layer={layer}
        range={range}
        region={region}
        basemap={basemap}
        values={values}
        medians={medians}
        points={points}
        selectedCell={layer === "grid" ? cell : null}
        onSelectCell={setCell}
        onSelectPoint={setPoint}
        onHover={setHover}
        onReady={(v) => (viewer.current = v)}
      />

      <Header
        meta={meta}
        onAbout={() => setAbout(true)}
        onMethod={() => setMethod(true)}
        onStory={storyReady ? playStory : undefined}
        storyLabel={`${STORY.region}, Aug ${STORY.year}`}
        datasets={datasets}
        datasetId={datasetId ?? ""}
        onDataset={setDatasetId}
      >
        <DownloadMenu
          data={data}
          region={region}
          range={range}
          sensor={sensor}
          values={values}
          medians={medians}
          getViewer={() => viewer.current}
        />
      </Header>

      <ControlPanel
        meta={meta}
        hasConv={!!data.monthly.conv}
        sensor={sensor}
        colorMode={colorMode}
        layer={layer}
        region={region}
        basemap={basemap}
        regionTotals={regionTotals}
        setSensor={setSensor}
        setColorMode={setColorMode}
        setLayer={setLayer}
        setRegion={chooseRegion}
        setBasemap={setBasemap}
      />

      <aside className="panel right glass">
        {point && layer === "points" ? (
          <PointDetail p={point} onClose={() => setPoint(null)} />
        ) : cell !== null && layer === "grid" ? (
          <CellDetail data={data} i={cell} range={range} medianTotal={medians[cell]} setRange={setRange} onClose={() => setCell(null)} />
        ) : (
          <InsightPanel data={data} region={region} range={range} sensor={sensor} colorMode={colorMode} setRange={setRange} />
        )}
      </aside>

      <Legend
        cell={`${meta.cell_size_m / 1000} km`}
        layer={layer}
        sensor={sensor}
        colorMode={colorMode}
        max={legendMax}
        baseline={`${meta.calibration.baseline_years[0]}–${meta.calibration.baseline_years[1]}`}
      />
      {layer === "points" && loadingPts && <div className="loading-pill glass">Loading detections…</div>}
      {switching && <div className="loading-pill glass">Loading {datasets.find((d) => d.id === datasetId)?.name ?? "dataset"}…</div>}

      <Timeline meta={meta} range={range} playing={playing} setRange={setRange} togglePlay={() => setPlaying((p) => !p)} />

      {hover && (
        <div className="hover-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <span>{hover.title}</span>
          <b>{hover.value}</b>
        </div>
      )}

      {about && (
        <AboutModal
          meta={meta}
          onClose={closeAbout}
          onMethod={() => {
            closeAbout();
            setMethod(true);
          }}
        />
      )}
      {method && <MethodPanel data={data} region={region} onClose={() => setMethod(false)} />}
    </div>
  );
}
