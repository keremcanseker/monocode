import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs` while `active`. Keep it in the
 * leaf that shows a live clock so a tick re-renders that row, not its list.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
