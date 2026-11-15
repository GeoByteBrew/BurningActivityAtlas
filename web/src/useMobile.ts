// AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
import { useEffect, useState } from "react";

/** Must match the phone breakpoint in styles/global.css. */
export const MOBILE_QUERY = "(max-width: 900px)";

export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const q = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return mobile;
}
