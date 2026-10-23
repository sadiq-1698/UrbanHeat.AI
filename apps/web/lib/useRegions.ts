"use client";

import { useEffect, useState } from "react";
import type { BBox } from "./map/geo";

export interface Region {
  id: string;
  bbox: BBox;
  layerCount: number;
}

interface LayerRow {
  region: string;
  bbox: BBox;
}

/** Group raster catalog rows into regions; each region's bbox is the union of its layers'. */
export function regionsFromLayers(rows: readonly LayerRow[]): Region[] {
  const byRegion = new Map<string, Region>();
  for (const { region, bbox } of rows) {
    const cur = byRegion.get(region);
    if (!cur) byRegion.set(region, { id: region, bbox: [...bbox], layerCount: 1 });
    else {
      cur.bbox = [Math.min(cur.bbox[0], bbox[0]), Math.min(cur.bbox[1], bbox[1]), Math.max(cur.bbox[2], bbox[2]), Math.max(cur.bbox[3], bbox[3])];
      cur.layerCount++;
    }
  }
  return [...byRegion.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export type RegionsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; regions: Region[] };

/** Loads the region list from /api/raster/layers once. */
export function useRegions(): RegionsState {
  const [state, setState] = useState<RegionsState>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/raster/layers", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { layers } = (await res.json()) as { layers: LayerRow[] };
        setState({ status: "ready", regions: regionsFromLayers(layers) });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => ctrl.abort();
  }, []);
  return state;
}
