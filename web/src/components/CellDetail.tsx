import { useMemo } from "react";
import { SENSOR_COLORS } from "../colors";
import { byYear, cellMonthly, cellRow, fmt, fmtRatio, cellRatio, isFull, rangeLabel, sumRange, yearOf, yearRange } from "../data";
import type { Dataset, PickedPoint, Range } from "../types";
import { AnnualChart, LegendDot, MonthlyChart } from "./charts";

export function CellDetail({
  data,
  i,
  range,
  medianTotal,
  setRange,
  onClose,
}: {
  data: Dataset;
  i: number;
  range: Range;
  medianTotal: number;
  setRange: (r: Range) => void;
  onClose: () => void;
}) {
  const c = data.cells;
  const meta = data.meta;
  const s = useMemo(
    () => ({ harm: cellMonthly(data, "harm", i), modis: cellMonthly(data, "modis", i), viirs: cellMonthly(data, "viirs", i) }),
    [data, i],
  );
  const harmY = byYear(meta, s.harm);
  const total = sumRange(s.harm, range);
  const ratio = cellRatio(total, medianTotal);
  const modisM = cellRow(c.modis_m, i, 12);
  const viirsM = cellRow(c.viirs_m, i, 12);
  const lat = (c.s[i] + c.n[i]) / 2;
  const lon = (c.w[i] + c.e[i]) / 2;
  const region = c.regions[c.region[i]] ?? "Outside AOI";
  const sel = (y: number) => !isFull(meta, range) && y >= yearOf(meta, range.start) && y <= yearOf(meta, range.end);

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="eyebrow">Selected cell · {region}</span>
          <h2 className="mono">{c.id[i]}</h2>
          <span className="coords mono">
            {lat.toFixed(3)}°N, {Math.abs(lon).toFixed(3)}°{lon < 0 ? "W" : "E"}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="kpis three">
        <div className="kpi">
          <span>{rangeLabel(meta, range)}</span>
          <b>{fmt(total)}</b>
        </div>
        <div className="kpi">
          <span>vs. normal</span>
          <b className={ratio >= 1.5 ? "c-hot" : ratio <= 0.67 ? "c-cold" : ""}>{isFull(meta, range) ? "–" : fmtRatio(ratio)}</b>
        </div>
        <div className="kpi">
          <span>Max FRP</span>
          <b>
            {fmt(c.frp_max[i])}
            <small> MW</small>
          </b>
        </div>
      </div>
      <div className="sec-head">
        <h3>Per year in this cell</h3>
        <div className="legend-row">
          <LegendDot color={SENSOR_COLORS.harm} label="Harmonized" />
          <LegendDot color={SENSOR_COLORS.modis} label="MODIS" dashed />
        </div>
      </div>
      <AnnualChart
        years={meta.years}
        bars={[{ key: "harm", label: "Harmonized", color: SENSOR_COLORS.harm, values: harmY }]}
        lines={[
          { key: "modis", label: "MODIS raw", color: SENSOR_COLORS.modis, values: byYear(meta, s.modis), dashed: true },
          { key: "viirs", label: "VIIRS raw", color: SENSOR_COLORS.viirs, values: byYear(meta, s.viirs), dashed: false },
        ]}
        isSelected={sel}
        onSelect={(y) => setRange(yearRange(meta, y))}
      />
      <p className="help small">Single cells are noisy; the harmonization is validated at regional and yearly scale.</p>
      <div className="sec-head">
        <h3>Fire season (all years)</h3>
      </div>
      <MonthlyChart
        series={[
          { key: "modis", label: "MODIS", color: SENSOR_COLORS.modis, values: modisM },
          { key: "viirs", label: "VIIRS", color: SENSOR_COLORS.viirs, values: viirsM },
        ]}
      />
    </div>
  );
}

export function PointDetail({ p, onClose }: { p: PickedPoint; onClose: () => void }) {
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="eyebrow">Fire detection · {p.night ? "night" : "day"} overpass</span>
          <h2>{p.platform}</h2>
          <span className="coords mono">
            {p.date} · {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="kpis three">
        <div className="kpi">
          <span>Fire power</span>
          <b>
            {p.frp.toFixed(1)}
            <small> MW</small>
          </b>
        </div>
        <div className="kpi">
          <span>Sensor</span>
          <b>{p.platform === "Terra" || p.platform === "Aqua" ? "MODIS" : "VIIRS"}</b>
        </div>
        <div className="kpi">
          <span>Pixel</span>
          <b>{p.platform === "Terra" || p.platform === "Aqua" ? "1 km" : "375 m"}</b>
        </div>
      </div>
      <a
        className="btn ghost wide"
        target="_blank"
        rel="noreferrer"
        href={`https://firms.modaps.eosdis.nasa.gov/map/#d:${p.date}..${p.date};@${p.lon.toFixed(3)},${p.lat.toFixed(3)},11.0z`}
      >
        Open in NASA FIRMS ↗
      </a>
    </div>
  );
}
