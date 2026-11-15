// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useMemo } from "react";
import { SENSOR_COLORS } from "../colors";
import {
  byYear,
  fmt,
  fmtRatio,
  inRange,
  isFull,
  medianRange,
  monthRange,
  MONTHS,
  rangeLabel,
  rangeLen,
  regionMonthly,
  samePeriodAcrossYears,
  singleYear,
  sumRange,
  yearOf,
  yearRange,
} from "../data";
import type { ColorMode, Dataset, Range, Sensor } from "../types";
import { AnnualChart, CalendarHeatmap, LegendDot, LineChart, type Bar } from "./charts";

interface Props {
  data: Dataset;
  region: string;
  range: Range;
  sensor: Sensor;
  colorMode: ColorMode;
  setRange: (r: Range) => void;
}

const ordinal = (n: number) => (n === 1 ? "highest" : n === 2 ? "2nd highest" : n === 3 ? "3rd highest" : `${n}th highest`);

function rankOf(values: number[], i: number) {
  return 1 + values.filter((v) => v > values[i]).length;
}

/** Monthly values inside the range, or the average month when the range spans many years. */
function rangeProfile(values: number[], r: Range, y0: number): { labels: string[]; vals: number[]; profile: boolean } {
  if (rangeLen(r) <= 36) {
    const labels: string[] = [];
    const vals: number[] = [];
    for (let k = r.start; k <= r.end; k++) {
      labels.push(rangeLen(r) <= 12 ? MONTHS[k % 12] : k % 12 === 0 ? `'${String(y0 + Math.floor(k / 12)).slice(2)}` : MONTHS[k % 12][0]);
      vals.push(values[k] ?? 0);
    }
    return { labels, vals, profile: false };
  }
  const s = new Array(12).fill(0);
  const n = new Array(12).fill(0);
  for (let k = r.start; k <= r.end; k++) {
    s[k % 12] += values[k] ?? 0;
    n[k % 12]++;
  }
  return { labels: MONTHS.map((m) => m[0]), vals: s.map((v, m) => (n[m] ? v / n[m] : 0)), profile: true };
}

export default function InsightPanel({ data, region, range, sensor, colorMode, setRange }: Props) {
  const { meta, series } = data;
  const years = meta.years;
  const rm = useMemo(() => regionMonthly(meta, series.regions[region] ?? series.regions.All), [data, region]);
  const regionName = region === "All" ? meta.region_name : region;
  const label = rangeLabel(meta, range);
  const [b0, b1] = meta.calibration.baseline_years;
  const harm = sensor === "harm";
  const viirsYear = Number((meta.viirs_start ?? meta.period[0]).slice(0, 4));

  const isSelectedYear = (y: number) => !isFull(meta, range) && y >= yearOf(meta, range.start) && y <= yearOf(meta, range.end);
  const pickYear = (y: number) => setRange(yearRange(meta, y));
  const pickCal = (yi: number, mi: number | null) =>
    setRange(mi === null ? yearRange(meta, years[yi]) : monthRange(meta, years[yi], mi));
  const calInRange = (yi: number, mi: number) => !isFull(meta, range) && inRange(range, yi * 12 + mi);

  const main = harm ? rm.harm : sensor === "modis" ? rm.modis : rm.viirs;
  const mainLabel = harm ? "Harmonized" : sensor === "modis" ? "MODIS" : "VIIRS";
  const mainColor = harm ? SENSOR_COLORS.harm : sensor === "modis" ? SENSOR_COLORS.modis : SENSOR_COLORS.viirs;
  const grid = years.map((_, yi) => main.slice(yi * 12, yi * 12 + 12));
  const prof = rangeProfile(main, range, years[0]);
  const peak = prof.vals.reduce((b, v, i) => (v > prof.vals[b] ? i : b), 0);
  const peakLabel = prof.profile
    ? MONTHS[peak]
    : `${MONTHS[(range.start + peak) % 12]}${yearOf(meta, range.start) !== yearOf(meta, range.end) ? ` ${yearOf(meta, range.start + peak)}` : ""}`;

  // ---- harmonized: how unusual is the selection?
  const total = sumRange(main, range);
  const normal = medianRange(rm.median, range);
  const ratio = normal > 0 ? total / normal : NaN;
  let rankText: string | null = null;
  let rank: [number, number] | null = null;
  const same = samePeriodAcrossYears(meta, range);
  const periodName = rangeLen(range) === 1 ? MONTHS[range.start % 12] : `${MONTHS[range.start % 12]}–${MONTHS[range.end % 12]}`;
  const y = singleYear(meta, range);
  if (same) {
    const vals = same.map((r) => sumRange(main, r));
    const yi = yearOf(meta, range.start) - years[0];
    rank = [rankOf(vals, yi), vals.length];
    rankText = `the ${ordinal(rank[0])} ${periodName} since ${years[0]}`;
  } else if (y !== null) {
    const vals = byYear(meta, main);
    rank = [rankOf(vals, y - years[0]), vals.length];
    rankText = `the ${ordinal(rank[0])} year since ${years[0]}`;
  }
  const annual = byYear(meta, main);
  const topYear = years[annual.indexOf(Math.max(...annual))];

  // ---- sensor comparison
  const tM = sumRange(rm.modis, range);
  const tV = sumRange(rm.viirs, range);
  const sensorRatio = tM > 0 ? tV / tM : NaN;

  const sentence = harm ? (
    isFull(meta, range) ? (
      <>
        <b>{fmt(total)}</b> harmonized fire detections in {years[0]}–{years.at(-1)}. Most active year: <b>{topYear}</b>. Fire season peaks in{" "}
        <b>{MONTHS[peak]}</b>.
      </>
    ) : Number.isFinite(ratio) ? (
      <>
        Fire activity was{" "}
        <b className={ratio >= 1.5 ? "c-hot" : ratio <= 0.67 ? "c-cold" : ""}>{fmtRatio(ratio)} the normal</b> for {label}
        {rankText ? (
          <>
            {" "}
            — <b>{rankText}</b>
          </>
        ) : null}
        .{" "}
        {ratio >= 2 ? "Clearly unusual." : ratio >= 1.25 ? "Above normal." : ratio <= 0.5 ? "Much quieter than usual." : ratio <= 0.8 ? "Below normal." : "Close to normal."}
      </>
    ) : (
      <>No fire activity is normally recorded in this period.</>
    )
  ) : (
    <>
      VIIRS detected <b className="c-viirs">{fmtRatio(sensorRatio)}</b> as many fires as MODIS in {label}
      {sensorRatio > 1.2 ? " — mostly small fires MODIS cannot resolve. This is why the records must be harmonized." : "."}
    </>
  );

  const rp = rangeProfile(Array.from({ length: main.length }, (_, k) => rm.median[k % 12]), range, years[0]);

  return (
    <>
      <div className="insight">
        <span className="eyebrow">
          {regionName} · {label}
        </span>
        <p>{sentence}</p>
      </div>

      {harm ? (
        <div className="kpis">
          <div className="kpi">
            <span>Harmonized detections</span>
            <b>{fmt(total)}</b>
          </div>
          <div className="kpi">
            <span>vs. normal ({b0}–{b1})</span>
            <b className={ratio >= 1.5 ? "c-hot" : ratio <= 0.67 ? "c-cold" : ""}>{isFull(meta, range) ? "–" : fmtRatio(ratio)}</b>
          </div>
          <div className="kpi">
            <span>Rank since {years[0]}</span>
            <b>
              {rank ? rank[0] : "–"}
              {rank && <small> / {rank[1]}</small>}
            </b>
          </div>
          <div className="kpi">
            <span>Peak month</span>
            <b>{prof.vals[peak] > 0 ? peakLabel : "–"}</b>
          </div>
        </div>
      ) : (
        <div className="kpis">
          <div className="kpi">
            <span>MODIS detections</span>
            <b className="c-modis">{fmt(tM)}</b>
          </div>
          <div className="kpi">
            <span>VIIRS detections</span>
            <b className="c-viirs">{fmt(tV)}</b>
          </div>
          <div className="kpi">
            <span>VIIRS / MODIS</span>
            <b>{fmtRatio(sensorRatio)}</b>
          </div>
          <div className="kpi">
            <span>Peak month</span>
            <b>{prof.vals[peak] > 0 ? peakLabel : "–"}</b>
          </div>
        </div>
      )}

      <section data-chart="annual">
        <div className="sec-head">
          <h3>{harm ? "Harmonized activity per year" : "Detections per year"}</h3>
          <div className="legend-row">
            {harm ? (
              <>
                <LegendDot color={SENSOR_COLORS.harm} label="Harmonized" />
                <LegendDot color={SENSOR_COLORS.conv} label="From MODIS" dashed />
              </>
            ) : (
              <>
                <LegendDot color={SENSOR_COLORS.modis} label="MODIS" />
                <LegendDot color={SENSOR_COLORS.viirs} label="VIIRS" />
              </>
            )}
          </div>
        </div>
        <AnnualChart
          years={years}
          bars={
            harm
              ? [{ key: "harm", label: "Harmonized", color: SENSOR_COLORS.harm, values: annual }]
              : [
                  { key: "modis", label: "MODIS", color: SENSOR_COLORS.modis, values: byYear(meta, rm.modis) },
                  { key: "viirs", label: "VIIRS", color: SENSOR_COLORS.viirs, values: byYear(meta, rm.viirs) },
                ]
          }
          lines={harm ? [{ key: "conv", label: "MODIS → VIIRS-eq.", color: SENSOR_COLORS.conv, values: byYear(meta, rm.conv), dashed: true }] : []}
          isSelected={isSelectedYear}
          onSelect={pickYear}
        />
        {harm && (
          <p className="help small">
            Dashed: what MODIS alone gives after conversion. Where it follows the bars, yearly totals from the two sensors agree; this holds for regional totals, not for single cells.
            {viirsYear > years[0] && ` Before ${viirsYear} there is no VIIRS: those bars are MODIS converted to VIIRS-equivalent counts.`}
          </p>
        )}
      </section>

      {same ? (
        <section data-chart="same-period">
          <div className="sec-head">
            <h3>{periodName} in every year</h3>
            <div className="legend-row">
              {harm ? (
                <>
                  <LegendDot color={mainColor} label={mainLabel} />
                  <LegendDot color={SENSOR_COLORS.median} label="Normal" dashed />
                </>
              ) : (
                <>
                  <LegendDot color={SENSOR_COLORS.modis} label="MODIS" />
                  <LegendDot color={SENSOR_COLORS.viirs} label="VIIRS" />
                </>
              )}
            </div>
          </div>
          <AnnualChart
            years={years}
            bars={
              harm
                ? [{ key: "main", label: mainLabel, color: mainColor, values: same.map((r) => sumRange(main, r)) }]
                : [
                    { key: "modis", label: "MODIS", color: SENSOR_COLORS.modis, values: same.map((r) => sumRange(rm.modis, r)) },
                    { key: "viirs", label: "VIIRS", color: SENSOR_COLORS.viirs, values: same.map((r) => sumRange(rm.viirs, r)) },
                  ]
            }
            lines={harm ? [{ key: "normal", label: "Normal", color: SENSOR_COLORS.median, values: years.map(() => normal), dashed: true }] : []}
            isSelected={isSelectedYear}
            onSelect={(yy) => setRange(same[yy - years[0]])}
          />
          <p className="help small">Click a year to see the same months there.</p>
        </section>
      ) : (
      <section data-chart="monthly">
        <div className="sec-head">
          <h3>{prof.profile ? "Average month" : `Monthly · ${label}`}</h3>
          <div className="legend-row">
            <LegendDot color={harm ? SENSOR_COLORS.harm : sensor === "modis" ? SENSOR_COLORS.modis : SENSOR_COLORS.viirs} label={mainLabel} />
            {harm && <LegendDot color={SENSOR_COLORS.median} label="Normal" dashed />}
          </div>
        </div>
        <LineChart
          labels={prof.labels}
          series={[
            { key: "main", label: mainLabel, color: mainColor, values: prof.vals },
            ...(harm ? [{ key: "median", label: `Normal (${b0}–${b1} median)`, color: SENSOR_COLORS.median, values: rp.vals, dashed: true }] : []),
          ]}
        />
      </section>
      )}

      <section data-chart="calendar">
        <div className="sec-head">
          <h3>Burning Activity Calendar</h3>
          <span className="tag">{harm && colorMode === "anomaly" ? "ratio to normal" : mainLabel}</span>
        </div>
        <CalendarHeatmap years={years} grid={grid} normal={harm && colorMode === "anomaly" ? rm.median : null} isInRange={calInRange} onPick={pickCal} />
        <p className="help small">Click a month to select it, or a year label to select the whole year.</p>
      </section>
    </>
  );
}
