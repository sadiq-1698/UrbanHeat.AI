"use client";

import { useEffect, useState } from "react";
import type { StationsRange } from "./queries/stations-range";

export type RangeState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; range: StationsRange };

/** Which days/hours have station readings for a region (from /api/stations/range). */
export function useStationsRange(region: string | undefined): RangeState {
  const [state, setState] = useState<RangeState>({ status: "loading" });
  useEffect(() => {
    if (!region) return;
    setState({ status: "loading" });
    const ctrl = new AbortController();
    fetch(`/api/stations/range?region=${encodeURIComponent(region)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ status: "ready", range: (await res.json()) as StationsRange });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => ctrl.abort();
  }, [region]);
  return state;
}
