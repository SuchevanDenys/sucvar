// app/lib/studio/useLoadingTicker.ts
"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Rotates through `stepCount` loading captions every `intervalMs` while a long request runs.
 *
 * Invariants: at most one interval is ever active (`start` clears the previous one), and the interval
 * is cleared on unmount, so navigating away mid-render never leaves a timer updating dead state.
 * `stepCount` is read when `start` is called; changing the language mid-run keeps the current cadence.
 */
export function useLoadingTicker(stepCount: number, intervalMs = 1500) {
  const [step, setStep] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setStep(0);
    timerRef.current = setInterval(() => setStep((s) => (s + 1) % stepCount), intervalMs);
  }, [stop, stepCount, intervalMs]);

  useEffect(() => stop, [stop]);

  return { step, start, stop };
}
