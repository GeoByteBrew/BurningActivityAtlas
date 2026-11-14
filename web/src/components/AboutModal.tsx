import { useEffect } from "react";
import type { Meta } from "../types";
import { FlameMark } from "./Header";

export default function AboutModal({ meta, onClose, onMethod }: { meta: Meta; onClose: () => void; onMethod?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal-hero">
          <FlameMark size={40} />
          <div>
            <h2>One fire record, two satellites</h2>
            <p>
              MODIS has watched fires since 2000. VIIRS, since 2012, sees them at 375 m instead of 1 km and catches far more small fires.
              Simply joining the two records creates a fake "more fires" trend. We measure the difference and calibrate it away.
            </p>
          </div>
        </div>

        <ol className="steps">
          <li>
            <b>Clean</b>
            <span>NASA FIRMS detections, filtered by confidence and fire type (vegetation only).</span>
          </li>
          <li>
            <b>Grid</b>
            <span>Every detection is counted in a global equal-area 5 km and 1 km grid (EASE-Grid 2.0).</span>
          </li>
          <li>
            <b>Calibrate</b>
            <span>Same-day MODIS and VIIRS counts give factors (by region, cell, month, day and night) turning MODIS into VIIRS-equivalent counts.</span>
          </li>
          <li>
            <b>Calendar</b>
            <span>The harmonized series becomes a month-by-year Burning Activity Calendar with anomalies.</span>
          </li>
        </ol>

        <div className="howto">
          <h3>Explore in 30 seconds</h3>
          <ul>
            <li>
              Pick a <b>period</b> on the timeline: a year, a month, or shift-click to span several. Red means more fire than normal
              for that time of year, blue means less.
            </li>
            <li>
              Click a cell in the <b>Burning Activity Calendar</b> to jump to that month. Press <kbd>Space</kbd> to play through the years.
            </li>
            <li>Click any column on the globe for that cell's history. Use <b>Download</b> for CSV, charts or a map image.</li>
            <li>
              <em>Compare sensors</em> shows raw MODIS, raw VIIRS, their raw gap, and what is left of it after conversion.
            </li>
            <li>
              "More than normal" means more <b>detections</b> than the usual count for those months. It is not burned area, number of
              fires or intensity. Years before 2012 are MODIS converted, not VIIRS observations (italic on the timeline).
            </li>
          </ul>
        </div>

        <div className="sources">
          <span>
            <b>Data</b> NASA FIRMS: MODIS MCD14ML C6.1 (Terra, Aqua), VIIRS VNP14IMG (Suomi NPP) · {meta.region_name}, {meta.period[0]} to{" "}
            {meta.period[1]}
          </span>
          <span>
            <b>Built with</b> CesiumJS, React, Python (pandas, GeoPandas) · data exported {meta.generated_at}
          </span>
        </div>

        <div className="modal-actions">
          {onMethod && (
            <button className="btn ghost" onClick={onMethod}>
              Does it work? See the evidence
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            Start exploring
          </button>
        </div>
      </div>
    </div>
  );
}
