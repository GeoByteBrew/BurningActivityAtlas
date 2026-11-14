import { useMemo, useRef, useState } from "react";
import { analyzeArea, polyToGeoJSON, readAreaFile, type Poly } from "../aoi";
import { SENSOR_COLORS } from "../colors";
import { byYear, fmt, fmtRatio, inRange, isFull, monthRange, MONTHS, rangeLabel, sumRange, yearOf, yearRange } from "../data";
import type { Dataset, Range } from "../types";
import { AnnualChart, CalendarHeatmap, LegendDot, LineChart } from "./charts";

/** Below this many cells the harmonized counts of an area are dominated by single-cell noise. */
const MIN_CELLS = 25;

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvBlob = (rows: (string | number)[][]) =>
  new Blob([rows.map((r) => r.map((v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n"], {
    type: "text/csv",
  });

export default function AreaPanel({
  data,
  range,
  setRange,
  area,
  areaName,
  setArea,
  onDraw,
  onClose,
}: {
  data: Dataset;
  range: Range;
  setRange: (r: Range) => void;
  area: Poly | null;
  areaName: string;
  setArea: (p: Poly | null, name?: string) => void;
  onDraw: () => void;
  onClose: () => void;
}) {
  const { meta } = data;
  const years = meta.years;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const res = useMemo(() => (area ? analyzeArea(data, area) : null), [data, area]);
  const [b0, b1] = meta.calibration.baseline_years;
  const slug = areaName.replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "-").toLowerCase() || "area";

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      setArea(await readAreaFile(f), f.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const picker = (
    <input
      ref={file}
      type="file"
      accept=".geojson,.json,.kml,.zip"
      hidden
      onChange={(e) => upload(e.target.files?.[0])}
    />
  );

  const head = (
    <div className="detail-head">
      <div>
        <span className="eyebrow">Analyze your area</span>
        <h2>{area ? areaName : "Your own boundary"}</h2>
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );

  if (!area || !res)
    return (
      <div className="detail area">
        {head}
        <p className="lead">
          Upload a project boundary or draw one on the map to get its harmonized fire record: monthly and yearly
          detections on the VIIRS scale, the ratio to normal and the burning calendar, ready to download.
        </p>
        <div className="area-actions">
          <button className="btn primary" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Reading…" : "Upload a file"}
          </button>
          <button className="btn ghost" onClick={onDraw}>
            Draw on the map
          </button>
        </div>
        {picker}
        {error && <p className="area-error">{error}</p>}
        <p className="help small">
          GeoJSON, KML or a zipped Shapefile in longitude / latitude. The file is read in your browser and never
          uploaded. Coverage: {meta.region_name}, {years[0]}–{years.at(-1)}, {meta.cell_size_m / 1000} km cells.
        </p>
      </div>
    );

  const n = res.cells.length;
  const total = sumRange(res.harm, range);
  let normal = 0;
  for (let k = range.start; k <= range.end; k++) normal += res.normal12[k % 12];
  const ratio = normal > 0 ? total / normal : NaN;
  const annual = byYear(meta, res.harm);
  const normalYear = res.normal12.reduce((a, b) => a + b, 0);
  const avgMonth = MONTHS.map((_, m) => years.reduce((s, _y, yi) => s + (res.harm[yi * 12 + m] ?? 0), 0) / years.length);
  const grid = years.map((_, yi) => res.harm.slice(yi * 12, yi * 12 + 12));
  const sel = (y: number) => !isFull(meta, range) && y >= yearOf(meta, range.start) && y <= yearOf(meta, range.end);
  const covered = Math.min(1, (n * res.cellKm2) / Math.max(res.areaKm2, 1e-9));

  const monthlyCsv = () => {
    const rows: (string | number)[][] = [
      ["month", "harmonized_viirs_eq", "normal_baseline_mean", "ratio_to_normal", "modis_raw_terra_aqua", `viirs_raw_${meta.reference_platform}`, "modis_converted_viirs_eq"],
    ];
    data.series.months.forEach((m, k) => {
      const nm = res.normal12[k % 12];
      rows.push([m, +res.harm[k].toFixed(2), +nm.toFixed(2), nm > 0 ? +(res.harm[k] / nm).toFixed(3) : "", res.modis[k], res.viirs[k], +res.conv[k].toFixed(2)]);
    });
    save(csvBlob(rows), `area_${slug}_monthly.csv`);
  };
  const annualCsv = () => {
    const rows: (string | number)[][] = [["year", "harmonized_viirs_eq", "normal_baseline_mean", "ratio_to_normal", "modis_raw_terra_aqua", `viirs_raw_${meta.reference_platform}`]];
    const mod = byYear(meta, res.modis);
    const vii = byYear(meta, res.viirs);
    years.forEach((y, yi) =>
      rows.push([y, +annual[yi].toFixed(2), +normalYear.toFixed(2), normalYear > 0 ? +(annual[yi] / normalYear).toFixed(3) : "", mod[yi], vii[yi]]),
    );
    save(csvBlob(rows), `area_${slug}_annual.csv`);
  };
  const cellsCsv = () => {
    const c = data.cells;
    const rows: (string | number)[][] = [["cell_id", "lat", "lon", "harmonized_total", "normal_per_year"]];
    const tot = new Float64Array(c.id.length);
    const h = data.monthly.harm ?? data.monthly.viirs;
    for (let j = 0; j < h.c.length; j++) tot[h.c[j]] += h.v[j];
    for (const i of res.cells) {
      let nm = 0;
      for (let m = 0; m < 12; m++) nm += data.normalDense[i * 12 + m];
      rows.push([c.id[i], +((c.s[i] + c.n[i]) / 2).toFixed(4), +((c.w[i] + c.e[i]) / 2).toFixed(4), +tot[i].toFixed(2), +nm.toFixed(2)]);
    }
    save(csvBlob(rows), `area_${slug}_cells.csv`);
  };
  const geojson = () =>
    save(new Blob([JSON.stringify(polyToGeoJSON(area, { name: areaName }))], { type: "application/geo+json" }), `area_${slug}.geojson`);

  return (
    <div className="detail area">
      {head}
      {error && (
        <p className="area-error" ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
          {error} The results below are still for the previous area.
        </p>
      )}

      {n === 0 ? (
        <p className="area-error">
          No fire was recorded inside this boundary in {years[0]}–{years.at(-1)}
          {res.outsideShare > 0.5 ? `, and most of it lies outside this dataset (${meta.region_name})` : ""}.
        </p>
      ) : (
        <>
          <div className="insight">
            <p>
              <b>{fmt(total)}</b> harmonized detections in {rangeLabel(meta, range)}
              {!isFull(meta, range) && Number.isFinite(ratio) && (
                <>
                  , <b className={ratio >= 1.5 ? "c-hot" : ratio <= 0.67 ? "c-cold" : ""}>{fmtRatio(ratio)}</b> the {b0}–{b1} normal
                </>
              )}
              . Peak month on average: <b>{MONTHS[avgMonth.indexOf(Math.max(...avgMonth))]}</b>.
            </p>
          </div>
          <div className="kpis three">
            <div className="kpi">
              <span>Area</span>
              <b>
                {fmt(res.areaKm2)}
                <small> km²</small>
              </b>
            </div>
            <div className="kpi">
              <span>Active cells</span>
              <b>{fmt(n)}</b>
            </div>
            <div className="kpi">
              <span>Most active year</span>
              <b>{years[annual.indexOf(Math.max(...annual))]}</b>
            </div>
          </div>

          {(n < MIN_CELLS || res.outsideShare > 0.05) && (
            <div className="caveat">
              {n < MIN_CELLS && (
                <span>
                  <b>Small area.</b> Only {n} cells of {meta.cell_size_m / 1000} km had fire here. The MODIS → VIIRS
                  conversion is reliable for regional, monthly and yearly totals; for a few cells the numbers are indicative.
                </span>
              )}
              {res.outsideShare > 0.05 && (
                <span>
                  <b>Partly outside the data.</b> About {Math.round(res.outsideShare * 100)}% of the boundary's extent is outside{" "}
                  {meta.region_name}; only the covered part is counted.
                </span>
              )}
            </div>
          )}

          <section data-chart="area-annual">
            <div className="sec-head">
              <h3>Harmonized activity per year</h3>
              <div className="legend-row">
                <LegendDot color={SENSOR_COLORS.harm} label="Harmonized" />
                <LegendDot color={SENSOR_COLORS.median} label="Normal" dashed />
              </div>
            </div>
            <AnnualChart
              years={years}
              bars={[{ key: "harm", label: "Harmonized", color: SENSOR_COLORS.harm, values: annual }]}
              lines={[{ key: "normal", label: "Normal", color: SENSOR_COLORS.median, values: years.map(() => normalYear), dashed: true }]}
              isSelected={sel}
              onSelect={(y) => setRange(yearRange(meta, y))}
            />
          </section>

          <section data-chart="area-season">
            <div className="sec-head">
              <h3>Fire season (average month)</h3>
              <div className="legend-row">
                <LegendDot color={SENSOR_COLORS.harm} label="Average" />
                <LegendDot color={SENSOR_COLORS.median} label="Normal" dashed />
              </div>
            </div>
            <LineChart
              labels={MONTHS.map((m) => m[0])}
              series={[
                { key: "avg", label: "Average", color: SENSOR_COLORS.harm, values: avgMonth },
                { key: "normal", label: `Normal (${b0}–${b1})`, color: SENSOR_COLORS.median, values: res.normal12, dashed: true },
              ]}
            />
          </section>

          <section data-chart="area-calendar">
            <div className="sec-head">
              <h3>Burning Activity Calendar</h3>
              <span className="tag">ratio to normal</span>
            </div>
            <CalendarHeatmap
              years={years}
              grid={grid}
              normal={res.normal12}
              isInRange={(yi, mi) => !isFull(meta, range) && inRange(range, yi * 12 + mi)}
              onPick={(yi, mi) => setRange(mi === null ? yearRange(meta, years[yi]) : monthRange(meta, years[yi], mi))}
            />
          </section>

          <p className="help small">
            Cells count when their centre is inside the boundary ({Math.round(covered * 100)}% of the area is in active
            cells; cells without any fire are not stored). Normal = {b0}–{b1} average of the same months.
          </p>
        </>
      )}

      <div className="sec-head">
        <h3>Download</h3>
      </div>
      <div className="area-downloads">
        <button className="btn ghost" disabled={!n} onClick={monthlyCsv}>
          Monthly CSV
        </button>
        <button className="btn ghost" disabled={!n} onClick={annualCsv}>
          Yearly CSV
        </button>
        <button className="btn ghost" disabled={!n} onClick={cellsCsv}>
          Cells CSV
        </button>
        <button className="btn ghost" onClick={geojson}>
          Boundary GeoJSON
        </button>
      </div>
      <p className="help small">Charts as PNG: header Download → Charts.</p>

      <div className="area-actions">
        <button className="btn ghost" onClick={() => file.current?.click()}>
          Upload another
        </button>
        <button className="btn ghost" onClick={onDraw}>
          Draw again
        </button>
        <button className="btn ghost" onClick={() => setArea(null)}>
          Clear
        </button>
      </div>
      {picker}
    </div>
  );
}
