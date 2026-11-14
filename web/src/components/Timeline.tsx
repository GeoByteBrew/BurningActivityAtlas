import { fullRange, isFull, MONTHS, monthRange, rangeLabel, yearOf, yearRange } from "../data";
import type { Meta, Range } from "../types";

/**
 * Year chips select a calendar year; month chips select a month of the active year.
 * Shift-click extends the current range (across years or months).
 */
export default function Timeline({
  meta,
  range,
  playing,
  setRange,
  togglePlay,
}: {
  meta: Meta;
  range: Range;
  playing: boolean;
  setRange: (r: Range) => void;
  togglePlay: () => void;
}) {
  const full = isFull(meta, range);
  const y0 = yearOf(meta, range.start);
  const y1 = yearOf(meta, range.end);
  const activeYear = !full && y0 === y1 ? y0 : null;
  const viirsYear = Number((meta.viirs_start ?? meta.period[0]).slice(0, 4));
  const calEnd = Number(meta.calibration.end.slice(0, 4));
  const testStart = Number(meta.calibration.independent_test[0].slice(0, 4));
  /** Role of a year in the harmonization: what the value shown for it is made of, and how far it was checked. */
  const phase = (y: number) =>
    y < viirsYear
      ? { cls: "backcast", tip: "MODIS only, converted to VIIRS-equivalent (backcast, not a VIIRS observation)" }
      : y <= calEnd
        ? { cls: "ph-cal", tip: "VIIRS observed · years used to calibrate the MODIS factors" }
        : y < testStart
          ? { cls: "ph-drift", tip: "VIIRS observed · drift check of the MODIS factors (not used for calibration)" }
          : { cls: "ph-test", tip: "VIIRS observed · independent test year" };

  const extend = (r: Range) =>
    setRange({ start: Math.min(range.start, r.start), end: Math.max(range.end, r.end) });

  const pickYear = (y: number, shift: boolean) => {
    const r = yearRange(meta, y);
    if (shift && !full) extend(r);
    else setRange(r);
  };
  const pickMonth = (m: number, shift: boolean) => {
    const y = activeYear ?? meta.years[meta.years.length - 1];
    const r = monthRange(meta, y, m);
    if (shift && activeYear !== null) extend(r);
    else setRange(r);
  };

  return (
    <div className="timeline glass">
      <button className="play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title="Play (Space)">
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14">
            <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="range-label">
        <span>Period</span>
        <b>{rangeLabel(meta, range)}</b>
      </div>
      <button className={`chip all ${full ? "on" : ""}`} onClick={() => setRange(fullRange(meta))}>
        All
      </button>
      <div className="years">
        {meta.years.map((y) => {
          const on = !full && y >= y0 && y <= y1;
          const ph = phase(y);
          return (
            <button
              key={y}
              className={`chip ${on ? "on" : ""} ${meta.harmonized ? ph.cls : ""}`}
              title={meta.harmonized ? `${y}: ${ph.tip}` : undefined}
              onClick={(e) => pickYear(y, e.shiftKey)}
            >
              {meta.years.length > 16 ? `'${String(y).slice(2)}` : y}
            </button>
          );
        })}
      </div>
      {meta.harmonized && (
        <div className="phase-key" aria-hidden>
          <span className="backcast">MODIS backcast</span>
          <span className="ph-cal">calibration</span>
          <span className="ph-drift">drift check</span>
          <span className="ph-test">test</span>
        </div>
      )}
      <div className={`months ${activeYear === null ? "dim" : ""}`}>
        {MONTHS.map((m, i) => {
          const k = activeYear === null ? -1 : (activeYear - meta.years[0]) * 12 + i;
          const on = activeYear !== null && k >= range.start && k <= range.end && range.end - range.start < 11;
          return (
            <button
              key={m}
              className={`chip month ${on ? "on" : ""}`}
              title={activeYear === null ? `${m} ${meta.years.at(-1)}` : `${m} ${activeYear} (shift-click to extend)`}
              onClick={(e) => pickMonth(i, e.shiftKey)}
            >
              {m[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
