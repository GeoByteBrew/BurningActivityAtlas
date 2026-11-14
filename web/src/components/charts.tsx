import { useLayoutEffect, useRef, useState } from "react";
import { anomalyRgb, fireRgb, logNorm, rgbCss } from "../colors";
import { fmt, fmtRatio, MONTHS, ratioToNormal } from "../data";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

export interface Bar {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

function YAxis({ ymax, y, x0, x1, fmtY = fmt }: { ymax: number; y: (v: number) => number; x0: number; x1: number; fmtY?: (v: number) => string }) {
  return (
    <>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={x0} x2={x1} y1={y(ymax * f)} y2={y(ymax * f)} className="grid-line" />
          <text x={x0 - 6} y={y(ymax * f) + 3} className="axis" textAnchor="end">
            {fmtY(ymax * f)}
          </text>
        </g>
      ))}
    </>
  );
}

/** Grouped annual bars with optional dashed lines; click a year to select it. */
export function AnnualChart({
  years,
  bars,
  lines = [],
  isSelected,
  onSelect,
}: {
  years: number[];
  bars: Bar[];
  lines?: Bar[];
  isSelected: (y: number) => boolean;
  onSelect: (y: number) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 150;
  const m = { l: 34, r: 6, t: 8, b: 20 };
  const all = [...bars, ...lines].flatMap((b) => b.values.filter((v): v is number => v !== null));
  const ymax = niceMax(Math.max(0, ...all));
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const step = iw / years.length;
  const bw = Math.min(bars.length === 1 ? 14 : 10, (step * 0.72) / Math.max(1, bars.length));
  const y = (v: number) => m.t + ih - (v / ymax) * ih;

  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} onMouseLeave={() => setHover(null)}>
        <YAxis ymax={ymax} y={y} x0={m.l} x1={W - m.r} />
        {years.map((yr, i) => {
          const x0 = m.l + i * step;
          const sel = isSelected(yr);
          const gx = x0 + step / 2 - (bw * bars.length) / 2;
          return (
            <g key={yr} className="year-col" onClick={() => onSelect(yr)} onMouseEnter={() => setHover(i)}>
              <rect x={x0} y={m.t} width={step} height={ih} className={`col-bg ${sel ? "sel" : ""} ${hover === i ? "hov" : ""}`} />
              {bars.map((b, k) => {
                const v = b.values[i];
                if (v === null)
                  return <rect key={b.key} x={gx + k * bw} y={m.t + ih - 3} width={bw - 1} height={3} className="nodata-bar" />;
                return (
                  <rect key={b.key} x={gx + k * bw} y={y(v)} width={bw - 1} height={Math.max(0, m.t + ih - y(v))} fill={b.color} rx={1} />
                );
              })}
              {(i % 2 === 0 || years.length < 9) && (
                <text x={x0 + step / 2} y={H - 6} className={`axis ${sel ? "axis-sel" : ""}`} textAnchor="middle">
                  {`'${String(yr).slice(2)}`}
                </text>
              )}
            </g>
          );
        })}
        {lines.map((line) => (
          <polyline
            key={line.key}
            fill="none"
            stroke={line.color}
            strokeWidth={1.8}
            strokeDasharray={line.dashed === false ? undefined : "4 3"}
            points={line.values
              .map((v, i) => (v === null ? null : `${m.l + i * step + step / 2},${y(v)}`))
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(W - 150, m.l + hover * step) }}>
          <b>{years[hover]}</b>
          {[...bars, ...lines].map((b) => (
            <span key={b.key}>
              <i style={{ background: b.color }} />
              {b.label}: {b.values[hover] === null ? "–" : fmt(b.values[hover]!)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Line chart over arbitrary x labels (months of a range or a 12-month profile). */
export function LineChart({ labels, series, height = 130 }: { labels: string[]; series: Bar[]; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const m = { l: 34, r: 8, t: 8, b: 20 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ymax = niceMax(Math.max(0, ...all));
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = labels.length;
  const x = (i: number) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / ymax) * ih;
  const every = Math.ceil(n / 12);

  return (
    <div ref={ref} className="chart">
      <svg
        width={W}
        height={H}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const bx = e.currentTarget.getBoundingClientRect().left;
          const i = Math.round(((e.clientX - bx - m.l) / iw) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        <YAxis ymax={ymax} y={y} x0={m.l} x1={W - m.r} />
        {labels.map((lab, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={H - 6} className="axis" textAnchor="middle">
              {lab}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} className="hover-line" />}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
          const valid = pts.filter((p): p is readonly [number, number] => p !== null);
          const path = valid.map((p) => `${p[0]},${p[1]}`).join(" ");
          return (
            <g key={s.key}>
              {!s.dashed && valid.length > 1 && (
                <polygon points={`${valid[0][0]},${m.t + ih} ${path} ${valid.at(-1)![0]},${m.t + ih}`} fill={s.color} opacity={0.1} />
              )}
              <polyline points={path} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "4 3" : undefined} />
              {n <= 24 && valid.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.2} fill={s.color} />)}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(W - 150, Math.max(0, x(hover) - 60)) }}>
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}: {s.values[hover] === null ? "–" : fmt(s.values[hover]!)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const MonthlyChart = ({ series }: { series: Bar[] }) => <LineChart labels={MONTHS.map((m) => m[0])} series={series} />;

/**
 * Burning Activity Calendar: years × months. In anomaly mode cells are coloured by ratio to the
 * calendar-month normal; otherwise by count.
 */
export function CalendarHeatmap({
  years,
  grid,
  normal,
  isInRange,
  onPick,
}: {
  years: number[];
  grid: number[][];
  normal: number[] | null;
  isInRange: (yi: number, mi: number) => boolean;
  onPick: (yi: number, mi: number | null) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ yi: number; mi: number } | null>(null);
  const m = { l: 34, t: 14 };
  const cw = (W - m.l - 2) / 12;
  const ch = 12;
  const max = Math.max(0, ...grid.flat());
  const H = m.t + years.length * ch + 2;
  const color = (v: number, mi: number) => {
    if (normal) return rgbCss(anomalyRgb(ratioToNormal(v, normal[mi])));
    return v === 0 ? "rgba(255,255,255,0.04)" : rgbCss(fireRgb(0.1 + 0.9 * logNorm(v, max)));
  };

  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} onMouseLeave={() => setTip(null)}>
        {MONTHS.map((mo, i) => (
          <text key={mo} x={m.l + i * cw + cw / 2} y={9} className="axis" textAnchor="middle">
            {mo[0]}
          </text>
        ))}
        {years.map((yr, yi) => (
          <g key={yr} className="cal-row">
            <text x={m.l - 6} y={m.t + yi * ch + ch - 2} className="axis axis-click" textAnchor="end" onClick={() => onPick(yi, null)}>
              {yr}
            </text>
            {grid[yi].map((v, mi) => (
              <rect
                key={mi}
                x={m.l + mi * cw + 0.5}
                y={m.t + yi * ch + 0.5}
                width={cw - 1}
                height={ch - 1}
                rx={1.5}
                fill={color(v, mi)}
                stroke={isInRange(yi, mi) ? "#fff" : "none"}
                strokeWidth={1.4}
                onMouseEnter={() => setTip({ yi, mi })}
                onClick={() => onPick(yi, mi)}
              />
            ))}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(W - 150, m.l + tip.mi * cw), top: m.t + tip.yi * ch + 16 }}>
          <b>
            {MONTHS[tip.mi]} {years[tip.yi]}
          </b>
          <span>{fmt(grid[tip.yi][tip.mi])} detections</span>
          {normal && (
            <span>
              {fmtRatio(ratioToNormal(grid[tip.yi][tip.mi], normal[tip.mi]))} normal ({fmt(normal[tip.mi])})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="legend-dot">
      <i style={dashed ? { background: "transparent", borderTop: `2px dashed ${color}`, height: 0, borderRadius: 0 } : { background: color }} />
      {label}
    </span>
  );
}
