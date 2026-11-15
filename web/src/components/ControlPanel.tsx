// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { SENSOR_COLORS } from "../colors";
import { fmt } from "../data";
import type { Basemap, ColorMode, Layer, Meta, Sensor } from "../types";

interface Props {
  meta: Meta;
  /** true when the dataset ships the cell-level MODIS-converted layer */
  hasConv?: boolean;
  sensor: Sensor;
  colorMode: ColorMode;
  layer: Layer;
  region: string;
  basemap: Basemap;
  regionTotals: Record<string, number>;
  setSensor: (s: Sensor) => void;
  setColorMode: (m: ColorMode) => void;
  setLayer: (l: Layer) => void;
  setRegion: (r: string) => void;
  setBasemap: (b: Basemap) => void;
}

const COMPARE: { id: Sensor; label: string; color: string; help: string }[] = [
  { id: "modis", label: "MODIS", color: SENSOR_COLORS.modis, help: "Terra + Aqua, 1 km pixels. Long record (2000–) but misses small fires." },
  { id: "viirs", label: "VIIRS", color: SENSOR_COLORS.viirs, help: "Suomi NPP, 375 m pixels. Sees several times more fire pixels than MODIS over the same ground." },
  { id: "diff", label: "Raw gap", color: "#9aa4b5", help: "Raw sensor difference: VIIRS − MODIS per cell, before any harmonization. Cyan: VIIRS sees more · Orange: MODIS sees more." },
  { id: "convdiff", label: "After conv.", color: SENSOR_COLORS.conv, help: "MODIS converted − real VIIRS per cell, VIIRS years only: what the conversion leaves behind. Cyan: converted MODIS is short (fires only VIIRS saw) · Orange: it overshoots." },
];

function CoverageBar({ meta, platform }: { meta: Meta; platform: string }) {
  const c = meta.coverage[platform];
  const t0 = Date.parse(meta.period[0]);
  const t1 = Date.parse(meta.period[1]);
  const f = (d: string) => Math.min(1, Math.max(0, (Date.parse(d) - t0) / (t1 - t0)));
  const color = meta.modis_platforms.includes(platform) ? SENSOR_COLORS.modis : SENSOR_COLORS.viirs;
  return (
    <div className="cov-row" title={c ? `${c.start} → ${c.end} · ${c.n.toLocaleString()} detections` : "not downloaded"}>
      <span className="cov-name">{platform}</span>
      <div className="cov-track">
        {c && <div className="cov-fill" style={{ left: `${f(c.start) * 100}%`, width: `${(f(c.end) - f(c.start)) * 100}%`, background: color }} />}
      </div>
      <span className="cov-n">{c ? fmt(c.n) : "–"}</span>
    </div>
  );
}

export default function ControlPanel(p: Props) {
  const harm = p.sensor === "harm";
  const compare = COMPARE.filter((s) => s.id !== "convdiff" || p.hasConv);
  const compareHelp = compare.find((s) => s.id === p.sensor)?.help;
  const cell = `${p.meta.cell_size_m / 1000} km`;
  const noPoints = p.meta.points === false;
  const onPoints = p.layer === "points";
  return (
    <aside className="panel left glass">
      <section>
        <h3>
          <span className="step">1</span> Fire activity
        </h3>
        <button className={`hero-choice ${harm ? "on" : ""}`} disabled={!p.meta.harmonized} onClick={() => p.setSensor("harm")}>
          <span className="hero-title">
            <i style={{ background: SENSOR_COLORS.harm }} /> Harmonized
          </span>
          <span className="hero-sub">One record on the VIIRS scale (VIIRS-equivalent detection counts)</span>
        </button>
        {harm && (
          <div className="seg mode-seg">
            <button className={p.colorMode === "anomaly" ? "on" : ""} disabled={onPoints} onClick={() => p.setColorMode("anomaly")}>
              Ratio to normal
            </button>
            <button className={p.colorMode === "count" ? "on" : ""} disabled={onPoints} onClick={() => p.setColorMode("count")}>
              Raw count
            </button>
          </div>
        )}
        {harm && (
          <p className="help">
            {onPoints
              ? `Colour modes apply to the ${cell} grid. Switch the map layer (step 3) to the grid to use them.`
              : p.colorMode === "anomaly"
                ? `Red: more fire than usual for these months (${p.meta.calibration.baseline_years.join("–")}). Blue: quieter than usual.`
                : `Number of harmonized fire detections per ${cell} cell in the selected period. Brighter red = more fire.`}
          </p>
        )}

        <div className="sub-head">Compare sensors</div>
        <div className={`seg ${compare.length === 4 ? "seg-4" : "seg-3"}`}>
          {compare.map((s) => (
            <button key={s.id} className={p.sensor === s.id ? "on" : ""} title={s.help} onClick={() => p.setSensor(s.id)}>
              <i style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
        {compareHelp && <p className="help">{compareHelp}</p>}
      </section>

      <section>
        <h3>
          <span className="step">2</span> Region
        </h3>
        <div className="region-list">
          {["All", ...p.meta.regions].map((r) => (
            <button key={r} className={p.region === r ? "on" : ""} onClick={() => p.setRegion(r)}>
              <span>{r === "All" ? p.meta.region_name : r}</span>
              <span className="num">{fmt(p.regionTotals[r] ?? 0)}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>
          <span className="step">3</span> Map layer
        </h3>
        <div className="seg">
          <button className={p.layer === "grid" ? "on" : ""} onClick={() => p.setLayer("grid")}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="1" y="8" width="3.5" height="7" fill="currentColor" />
              <rect x="6.25" y="3" width="3.5" height="12" fill="currentColor" />
              <rect x="11.5" y="6" width="3.5" height="9" fill="currentColor" />
            </svg>
            {cell} grid
          </button>
          <button
            className={p.layer === "points" ? "on" : ""}
            disabled={noPoints}
            title={noPoints ? "Single detections are available in the regional views (switch with View, top right)" : undefined}
            onClick={() => p.setLayer("points")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <circle cx="4" cy="5" r="2" fill="currentColor" />
              <circle cx="11" cy="4" r="1.4" fill="currentColor" />
              <circle cx="9" cy="11" r="2.6" fill="currentColor" />
              <circle cx="3" cy="12" r="1.2" fill="currentColor" />
            </svg>
            Detections
          </button>
        </div>
        <div className="sub-head">Basemap</div>
        <div className="seg seg-3">
          {(
            [
              ["dark", "Dark"],
              ["satellite", "Satellite"],
              ["bluemarble", "Blue Marble"],
            ] as [Basemap, string][]
          ).map(([id, label]) => (
            <button key={id} className={p.basemap === id ? "on" : ""} onClick={() => p.setBasemap(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="data-block">
        <h3>Data loaded</h3>
        {p.meta.platforms.map((pl) => (
          <CoverageBar key={pl} meta={p.meta} platform={pl} />
        ))}
        <div className="cov-axis">
          <span>{p.meta.period[0].slice(0, 4)}</span>
          <span>{p.meta.period[1].slice(0, 4)}</span>
        </div>
        <p className="help small">
          Quality filter {p.meta.qc_scenario}: {p.meta.qc_description}. Vegetation fires only. Harmonized series uses{" "}
          {p.meta.reference_platform} as reference
          {p.meta.backup_platforms?.length ? `, ${p.meta.backup_platforms.join(" / ")} as backup when it is down` : ""}.
          {p.meta.points_dropped ? ` Detections layer: the ${fmt(p.meta.points_dropped)} weakest detections are not drawn.` : ""}
        </p>
      </section>
    </aside>
  );
}
