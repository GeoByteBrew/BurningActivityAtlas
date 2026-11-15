// AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
import { useEffect, useState } from "react";
import { Cartesian3, Math as CesiumMath, type Viewer } from "cesium";

/** Zoom ± and a north compass that follows the camera heading. */
export default function MapControls({ getViewer }: { getViewer: () => Viewer | null }) {
  const [heading, setHeading] = useState(0);

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

  const zoom = (dir: 1 | -1) => {
    const v = getViewer();
    if (!v) return;
    const h = Cartesian3.magnitude(v.camera.positionWC);
    // Multiply height: in → closer, out → farther.
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
    <div className="map-controls" role="toolbar" aria-label="Map navigation">
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
    </div>
  );
}
