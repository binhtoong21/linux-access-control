import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs`, so time-based labels (readiness, "x phút trước") move on their own. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
