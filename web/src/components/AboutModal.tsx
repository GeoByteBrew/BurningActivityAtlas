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
          <h3>World result (2003–2025)</h3>
          <ul>
            <li>
              Terra+Aqua → VIIRS factor <b>4.05×</b> (90% CI 4.01–4.10). On held-out months, MODIS / VIIRS goes from{" "}
              <b>0.24 → 0.98</b> after conversion; region × month correlation with VIIRS is <b>1.00</b>.
            </li>
            <li>
              After calibration (2020–2025) the yearly converted / VIIRS ratio stays between <b>0.94 and 1.01</b> — no large Terra+Aqua
              drift.
            </li>
            <li>
              <b>Known limits:</b> totals are ~5% low in the calibration years (so 2003–2011 are likely ~5% low vs VIIRS years);
              single cells stay uncertain; Eastern Asia converts low (~0.76); some volcanoes / industrial sources mismatch between
              products (e.g. Iceland 2021). This world run uses MODIS + S-NPP only.
            </li>
          </ul>
        </div>

        <div className="howto">
          <h3>Explore in 30 seconds</h3>
          <ul>
            <li>
              Switch <b>dataset</b> (top): World at 50 km, or a regional window at 5 km with single detections.
            </li>
            <li>
              Pick a <b>period</b> on the timeline: a year, a month, or shift-click to span several. In Ratio to normal, red means more
              fire than usual for that time of year, blue means less.
            </li>
            <li>
              Click a cell in the <b>Burning Activity Calendar</b> to jump to that month. Press <kbd>Space</kbd> to play through the years.
            </li>
            <li>
              <b>Your area</b>: upload GeoJSON / KML / Shapefile or draw a polygon — get the harmonized series, ratio to normal, calendar
              and CSV for that boundary (computed in the browser).
            </li>
            <li>Click any column on the globe for that cell's history. Use <b>Download</b> for CSV, charts or a map image.</li>
            <li>
              "More than normal" means more <b>detections</b> than the usual count for those months. It is not burned area, number of
              fires or intensity. Years before 2012 are MODIS converted, not VIIRS observations (italic on the timeline).
            </li>
          </ul>
        </div>

        <div className="sources">
          <span>
            <b>Data</b> NASA FIRMS: MODIS MCD14ML C6.1 (Terra, Aqua), VIIRS VNP14IMG ({meta.reference_platform}
            {meta.platforms?.length ? `; platforms in this dataset: ${meta.platforms.join(", ")}` : ""}) · {meta.region_name},{" "}
            {meta.period[0]} to {meta.period[1]}
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
