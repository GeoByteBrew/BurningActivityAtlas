// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useMemo, useState } from "react";
import { SENSOR_COLORS } from "../colors";
import { byYear, fmt, regionMonthly } from "../data";
import type { Dataset, Row } from "../types";
import { AnnualChart, LegendDot } from "./charts";

const CONFIG = "terra+aqua";
const num = (r: Row | undefined, k: string) => (r ? Number(r[k]) : NaN);

function RatioChart({ rows, calEnd, testStart }: { rows: Row[]; calEnd: number; testStart: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 620;
  const H = 210;
  const m = { l: 34, r: 12, t: 14, b: 24 };
  const years = rows.map((r) => Number(r.year));
  const yMax = 1.4;
  const bw = (W - m.l - m.r) / years.length;
  const x = (i: number) => m.l + bw * (i + 0.5);
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - Math.min(v, yMax) / yMax);
  const band = (a: number, b: number) => {
    const i0 = years.findIndex((yy) => yy >= a);
    const i1 = years.length - 1 - [...years].reverse().findIndex((yy) => yy <= b);
    return i0 < 0 || i1 < i0 ? null : { x: m.l + bw * i0, w: bw * (i1 - i0 + 1) };
  };
  const bands = [
    { ...band(years[0], calEnd), label: "Calibration", cls: "cal" },
    { ...band(calEnd + 1, testStart - 1), label: "Drift check", cls: "drift" },
    { ...band(testStart, years[years.length - 1]), label: "Test", cls: "test" },
  ].filter((b) => b.w);
  const line = (k: string) => rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(num(r, k))}`).join("");

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" onMouseLeave={() => setHover(null)}>
        {bands.map((b) => (
          <g key={b.label} className={`band ${b.cls}`}>
            <rect x={b.x} y={m.t} width={b.w} height={H - m.t - m.b} />
            <text x={b.x! + 6} y={m.t + 12}>
              {b.label}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className={v === 1 ? "ref-line" : "grid-line"} x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
            <text className="axis" x={m.l - 6} y={y(v) + 3} textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={line("raw_ratio")} fill="none" stroke={SENSOR_COLORS.modis} strokeWidth={2} strokeDasharray="5 4" />
        <path d={line("harm_ratio")} fill="none" stroke={SENSOR_COLORS.conv} strokeWidth={2.4} />
        {rows.map((r, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(num(r, "harm_ratio"))} r={hover === i ? 4.5 : 3} fill={SENSOR_COLORS.conv} />
            <circle cx={x(i)} cy={y(num(r, "raw_ratio"))} r={2.5} fill={SENSOR_COLORS.modis} />
            <text className="axis" x={x(i)} y={H - 8} textAnchor="middle">
              {years.length > 10 ? `'${String(years[i]).slice(2)}` : years[i]}
            </text>
            <rect x={x(i) - bw / 2} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{years[hover]}</b>
          <span>
            Converted ÷ VIIRS <b>{num(rows[hover], "harm_ratio").toFixed(2)}</b>
          </span>
          <span>
            Raw MODIS ÷ VIIRS <b>{num(rows[hover], "raw_ratio").toFixed(2)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export default function MethodPanel({ data, region, onClose }: { data: Dataset; region: string; onClose: () => void }) {
  const { meta, validation: v, series } = data;
  const [reg, setReg] = useState(region);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const calEnd = Number(meta.calibration.end.slice(0, 4));
  const testStart = Number(meta.calibration.independent_test[0].slice(0, 4));
  const factor = v.factors.find((r) => r.config === CONFIG);
  const byYearRows = v.by_year.filter((r) => r.config === CONFIG);
  const testRows = byYearRows.filter((r) => Number(r.year) >= testStart);
  const driftRows = byYearRows.filter((r) => Number(r.year) > calEnd && Number(r.year) < testStart);
  const pooled = (rows: Row[]) => {
    const s = (k: string) => rows.reduce((a, r) => a + num(r, k), 0);
    return { raw: s("modis") / s("viirs"), harm: s("harm") / s("viirs") };
  };
  const drift = pooled(driftRows);
  const test = pooled(testRows);
  const cellTest = v.test.find((r) => r.config === CONFIG);
  const driftRatios = driftRows.map((r) => num(r, "harm_ratio")).filter(Number.isFinite);
  const driftMin = Math.min(...driftRatios);
  const driftMax = Math.max(...driftRatios);
  const worst = driftRows.reduce<Row | undefined>((a, r) => (!a || Math.abs(Math.log(num(r, "harm_ratio"))) > Math.abs(Math.log(num(a, "harm_ratio"))) ? r : a), undefined);
  const stable = driftRatios.length > 0 && driftMin >= 0.9 && driftMax <= 1.1;
  const dn = (v.factors_dn ?? []).filter((r) => r.config === CONFIG);
  const dnTest = (v.test_daynight ?? []).filter((r) => r.config === CONFIG);
  const outages = v.outages ?? [];
  const scope = v.scope ?? meta.validation_scope;
  const rank = cellTest ? num(cellTest, "spearman_both") : NaN;

  const annual = useMemo(() => {
    const rm = regionMonthly(meta, series.regions[reg] ?? series.regions.All);
    return { viirs: byYear(meta, rm.viirs), conv: byYear(meta, rm.conv), modis: byYear(meta, rm.modis) };
  }, [meta, series, reg]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal method glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <span className="eyebrow">Method & validation</span>
        <h2>Does the MODIS → VIIRS conversion hold up?</h2>
        <p className="lead">
          VIIRS sees about {factor ? num(factor, "f_n").toFixed(1) : "3"}× more fire detections than MODIS over the same ground on the same
          days. We learn that factor from the VIIRS years up to {calEnd} only, then check it on years the model never saw.
          {scope && scope !== meta.region_name ? ` Factors and scores below are computed on the whole ${scope} domain.` : ""}
        </p>

        <div className="kpis four">
          <div className="kpi">
            <span>Conversion factor</span>
            <b className="c-conv">{factor ? `${num(factor, "f_n").toFixed(2)}×` : "–"}</b>
            {factor && (
              <small>
                90% CI {num(factor, "ci05").toFixed(2)}–{num(factor, "ci95").toFixed(2)}
              </small>
            )}
          </div>
          <div className="kpi">
            <span>Raw MODIS ÷ VIIRS</span>
            <b className="c-modis">{test.raw.toFixed(2)}</b>
            <small>{testStart} test, before</small>
          </div>
          <div className="kpi">
            <span>Converted ÷ VIIRS</span>
            <b className="c-conv">{test.harm.toFixed(2)}</b>
            <small>{testStart} test, after (ideal 1.00)</small>
          </div>
          <div className="kpi">
            <span>Drift {calEnd + 1}–{testStart - 1}</span>
            <b>{drift.harm.toFixed(2)}</b>
            <small>converted ÷ VIIRS</small>
          </div>
        </div>

        <section>
          <div className="sec-head">
            <h3>Ratio to real VIIRS, every year</h3>
            <div className="legend-row">
              <LegendDot color={SENSOR_COLORS.conv} label="MODIS converted" />
              <LegendDot color={SENSOR_COLORS.modis} label="MODIS raw" dashed />
            </div>
          </div>
          <RatioChart rows={byYearRows} calEnd={calEnd} testStart={testStart} />
          <p className="help">
            A line at 1.0 means the converted MODIS record counts the same fire activity as VIIRS.{" "}
            {driftRatios.length === 0
              ? ""
              : stable
                ? `After ${calEnd} every year stays within ±10% of 1 (${driftMin.toFixed(2)}–${driftMax.toFixed(2)}): no sign of drift so far.`
                : `Pooled over ${calEnd + 1}–${testStart - 1} the ratio is ${drift.harm.toFixed(2)}, so aggregate consistency holds, but single years range from ${driftMin.toFixed(2)} to ${driftMax.toFixed(2)} (${worst ? worst.year : ""}: ${worst ? num(worst, "harm_ratio").toFixed(2) : ""}). Such departures can come from the ageing Terra and Aqua orbits or from a single large fire episode; the regional table of the report tells them apart.`}
          </p>
          {dn.length > 0 && (
            <p className="help">
              Day and night are converted separately ({dn.map((r) => `${r.dn === "D" ? "day" : r.dn === "N" ? "night" : r.dn} ${num(r, "f_n").toFixed(2)}×`).join(", ")}): VIIRS gains
              more over MODIS at night.
              {dnTest.length === 2
                ? ` On held-out months the cell-level error is ${dnTest.map((r) => `${num(r, "mae_harm").toFixed(2)} with ${r.daynight} factors`).join(" and ")}.`
                : ""}
            </p>
          )}
          {outages.length > 0 && (
            <p className="help">
              {outages.length} satellite outage{outages.length > 1 ? "s" : ""} are excluded from calibration and filled from the next
              available source{meta.backup_platforms?.length ? ` (${meta.backup_platforms.join(", ")}, then MODIS converted)` : ""}, so a day
              without data is never read as a day without fire.
            </p>
          )}
        </section>

        <section>
          <div className="sec-head">
            <h3>Annual detections · {reg === "All" ? meta.region_name : reg}</h3>
            {meta.regions.length <= 5 ? (
              <div className="seg small">
                {["All", ...meta.regions].map((r) => (
                  <button key={r} className={r === reg ? "on" : ""} onClick={() => setReg(r)}>
                    {r === "All" ? "All" : r}
                  </button>
                ))}
              </div>
            ) : (
              <select className="region-select" value={reg} onChange={(e) => setReg(e.target.value)}>
                {["All", ...meta.regions].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>
          <AnnualChart
            years={meta.years}
            bars={[{ key: "viirs", label: "VIIRS (reference)", color: SENSOR_COLORS.viirs, values: annual.viirs }]}
            lines={[
              { key: "conv", label: "MODIS converted", color: SENSOR_COLORS.conv, values: annual.conv },
              { key: "modis", label: "MODIS raw", color: SENSOR_COLORS.modis, values: annual.modis, dashed: true },
            ]}
            isSelected={() => false}
            onSelect={() => {}}
          />
          <div className="legend-row">
            <LegendDot color={SENSOR_COLORS.viirs} label="VIIRS (reference)" />
            <LegendDot color={SENSOR_COLORS.conv} label="MODIS converted" dashed />
            <LegendDot color={SENSOR_COLORS.modis} label="MODIS raw" dashed />
          </div>
        </section>

        <section>
          <h3>Factors by region</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Region</th>
                <th>Factor</th>
                <th>90% CI</th>
                <th>Months</th>
                <th>MODIS / VIIRS detections</th>
              </tr>
            </thead>
            <tbody>
              {[...v.factors.filter((r) => r.config === CONFIG).map((r): Row => ({ ...r, region: "All (pooled)" })), ...v.factors_region.filter((r) => r.config === CONFIG)]
                .map((r) => (
                  <tr key={String(r.region)}>
                    <td>{String(r.region)}</td>
                    <td className="mono">{num(r, "f_n").toFixed(2)}×</td>
                    <td className="mono">
                      {num(r, "ci05").toFixed(2)}–{num(r, "ci95").toFixed(2)}
                    </td>
                    <td className="mono">{num(r, "n_months")}</td>
                    <td className="mono">
                      {fmt(num(r, "m_total"))} / {fmt(num(r, "v_total"))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="help">
            Factors use same-day pairs only and are shrunk towards the pooled value (K = 50) so small regions do not get noisy factors.
          </p>
        </section>

        <div className="caveat">
          <b>Where it works, and where it doesn't</b>
          <span>
            The conversion is reliable for regional, monthly and yearly totals, which is what the calendar and the anomaly map use. For a
            single 5 km cell in a single month it is not: on held-out months the cell-level error goes from {num(cellTest, "mae_raw").toFixed(1)} to{" "}
            {num(cellTest, "mae_harm").toFixed(1)} detections{Number.isFinite(rank) ? ` and the rank correlation, where both sensors saw fire, is about ${rank.toFixed(2)}` : ""}.
            In {Number.isFinite(num(cellTest, "modis_miss")) ? `${(100 * num(cellTest, "modis_miss")).toFixed(0)}% of` : "many"} cell-months with VIIRS fire, MODIS saw
            nothing: a multiplier cannot recreate those fires cell by cell, only on average. Read the harmonized record as activity levels
            and trends, not as a reconstruction of 375 m hotspots.
          </span>
        </div>
      </div>
    </div>
  );
}
