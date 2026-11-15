// AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
import { useEffect, useRef, useState } from "react";
import { Cartesian3, Math as CesiumMath, type Viewer } from "cesium";
import type { Basemap } from "../types";

const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "satellite", label: "Satellite" },
  { id: "bluemarble", label: "Blue Marble" },
];

/** Zoom ±, north compass, and basemap picker — map-side, not in the left panel. */
export default function MapControls({
  getViewer,
  basemap,
  setBasemap,
}: {
  getViewer: () => Viewer | null;
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
}) {
  const [heading, setHeading] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let remove: (() => void) | undefined;
    let tries = 0;
    const attach = () => {
      const v = getViewer();
      if (!v) {
        if (tries++ < 40) requestAnimationFrame(attach);
        return;
      }
      const sync = () => setHeading(v.camera.heading);
      sync();
      remove = v.camera.changed.addEventListener(sync);
    };
    attach();
    return () => remove?.();
  }, [getViewer]);

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

  const zoom = (dir: 1 | -1) => {
    const v = getViewer();
    if (!v) return;
    const h = Cartesian3.magnitude(v.camera.positionWC);
    const next = dir < 0 ? h * 0.55 : h * 1.8;
    const min = v.scene.screenSpaceCameraController.minimumZoomDistance;
    const max = v.scene.screenSpaceCameraController.maximumZoomDistance;
    const target = Math.min(max, Math.max(min, next));
    const c = v.camera.positionCartographic;
    v.camera.flyTo({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, target),
      orientation: { heading: v.camera.heading, pitch: v.camera.pitch, roll: 0 },
      duration: 0.45,
    });
  };

  const north = () => {
    const v = getViewer();
    if (!v) return;
    const c = v.camera.positionCartographic;
    v.camera.flyTo({
      destination: Cartesian3.fromRadians(c.longitude, c.latitude, c.height),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-85), roll: 0 },
      duration: 0.55,
    });
  };

  return (
    <div className="map-controls" ref={root} role="toolbar" aria-label="Map navigation">
      <button type="button" className="map-ctrl glass" onClick={() => zoom(-1)} title="Zoom in" aria-label="Zoom in">
        +
      </button>
      <button type="button" className="map-ctrl glass" onClick={() => zoom(1)} title="Zoom out" aria-label="Zoom out">
        −
      </button>
      <button type="button" className="map-ctrl compass glass" onClick={north} title="Reset north (top-down)" aria-label="Reset north">
        <span className="compass-rose" style={{ transform: `rotate(${(-heading * 180) / Math.PI}deg)` }}>
          <i className="compass-n">N</i>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <polygon points="12,3 15,14 12,12 9,14" fill="#ff5a4a" />
            <polygon points="12,21 15,10 12,12 9,10" fill="currentColor" opacity="0.55" />
          </svg>
        </span>
      </button>

      <div className="map-basemap">
        <button
          type="button"
          className={`map-ctrl glass ${open ? "on" : ""}`}
          onClick={() => setOpen((o) => !o)}
          title="Basemap"
          aria-label="Basemap"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3 12h18M12 3c2.8 3.2 2.8 14.8 0 18M12 3c-2.8 3.2-2.8 14.8 0 18" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {open && (
          <div className="map-basemap-menu glass" role="listbox" aria-label="Basemap">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={basemap === b.id}
                className={basemap === b.id ? "on" : ""}
                onClick={() => {
                  setBasemap(b.id);
                  setOpen(false);
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
