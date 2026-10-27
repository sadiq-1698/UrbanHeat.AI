"use client";

import { useEffect, useState } from "react";
import type { Legend } from "./raster-tiles";

export type LegendState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; legend: Legend };

/** Loads the server's color ramp for a raster layer so the legend always matches the tiles. */
export function useLegend(region: string | undefined, kind: string | undefined, enabled: boolean): LegendState {
  const [state, setState] = useState<LegendState>({ status: "idle" });
  useEffect(() => {
    if (!enabled || !region || !kind) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const ctrl = new AbortController();
    fetch(`/api/raster/legend?region=${encodeURIComponent(region)}&kind=${encodeURIComponent(kind)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ status: "ready", legend: (await res.json()) as Legend });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [region, kind, enabled]);
  return state;
}
