// AI disclosure: contains code written or modified with a large language model (Claude, Anthropic). See AI_USE.md.
import { useEffect, useRef, useState } from "react";
import type { Basemap } from "../types";

const BASEMAP_LINE: Record<Basemap, string> = {
  dark: "Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors",
  satellite: "Imagery © Esri, Maxar, Earthstar Geographics",
  bluemarble: "NASA Blue Marble · GIBS / Worldview",
};

/** Compact “Data attribution” control: click to list sources in a small panel. */
export default function Attribution({ basemap }: { basemap: Basemap }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="attr" ref={root}>
      <button
        type="button"
        className={`attr-trigger glass ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Data attribution
      </button>
      {open && (
        <div className="attr-menu glass" role="dialog" aria-label="Data attribution">
          <p className="attr-head">Data attribution</p>
          <ul>
            <li>
              <b>Fire detections</b>
              <span>
                <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer">
                  NASA FIRMS
                </a>{" "}
                — MODIS MCD14ML C6.1 (Terra, Aqua) · VIIRS VNP14IMG (Suomi-NPP)
              </span>
            </li>
            <li>
              <b>Basemap</b>
              <span>{BASEMAP_LINE[basemap]}</span>
            </li>
            <li>
              <b>Globe</b>
              <span>
                <a href="https://cesium.com/" target="_blank" rel="noopener noreferrer">
                  Cesium
                </a>
              </span>
            </li>
            <li>
              <b>Boundaries &amp; grid</b>
              <span>Natural Earth administrative areas · EASE-Grid 2.0 (EPSG:6933)</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
