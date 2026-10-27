import type { MapEventType, MapLibreMap, RasterTileSource } from "maplibre-gl";
import type { BBox } from "./geo";
import { tileUrlTemplate } from "./raster";

const SOURCE = "raster-overlay";
const LAYER = "raster-overlay";

export interface RasterStatus {
  state: "loading" | "ready" | "error";
  message?: string;
}

export interface RasterLayerOptions {
  region: string;
  kind: string;
  /** Region extent: MapLibre won't request tiles outside it. */
  bounds: BBox;
  visible: boolean;
  opacity: number;
  onStatus: (s: RasterStatus) => void;
}

export interface RasterLayerHandle {
  setKind(kind: string): void;
  /** Re-request the current kind's tiles (e.g. "Retry" after failures). */
  refresh(): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  destroy(): void;
}

/** Layer id to insert under, so the overlay sits beneath land cover, stations and the basemap's labels. */
function beforeId(map: MapLibreMap): string | undefined {
  if (map.getLayer("land-cover-fill")) return "land-cover-fill";
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

/**
 * A raster tile overlay served by /api/raster/tile. Switching kind swaps the source's tile URL in place.
 * While hidden, MapLibre doesn't fetch tiles for it.
 */
export function attachRaster(map: MapLibreMap, opts: RasterLayerOptions): RasterLayerHandle {
  let destroyed = false;
  let visible = opts.visible;
  let kind = opts.kind;
  const origin = window.location.origin;

  map.addSource(SOURCE, {
    type: "raster",
    tiles: [tileUrlTemplate(origin, opts.region, opts.kind)],
    tileSize: 256,
    bounds: opts.bounds,
    maxzoom: 18,
  });
  map.addLayer(
    {
      id: LAYER,
      type: "raster",
      source: SOURCE,
      layout: { visibility: visible ? "visible" : "none" },
      paint: { "raster-opacity": opts.opacity, "raster-fade-duration": 150 },
    },
    beforeId(map),
  );

  const onSourceData = (e: MapEventType["sourcedata"]) => {
    if (destroyed || e.sourceId !== SOURCE) return;
    if (e.isSourceLoaded) opts.onStatus({ state: "ready" });
  };
  const onError = (e: MapEventType["error"] & { sourceId?: string }) => {
    if (destroyed || e.sourceId !== SOURCE) return;
    opts.onStatus({ state: "error", message: e.error?.message ?? "tile request failed" });
  };
  map.on("sourcedata", onSourceData);
  map.on("error", onError);
  opts.onStatus({ state: "loading" });

  return {
    setKind(next) {
      kind = next;
      opts.onStatus({ state: "loading" });
      (map.getSource(SOURCE) as RasterTileSource).setTiles([tileUrlTemplate(origin, opts.region, kind)]);
    },
    refresh() {
      this.setKind(kind);
    },
    setVisible(next) {
      visible = next;
      map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
    },
    setOpacity(next) {
      map.setPaintProperty(LAYER, "raster-opacity", next);
    },
    destroy() {
      destroyed = true;
      map.off("sourcedata", onSourceData);
      map.off("error", onError);
      try {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {
        /* map already removed */
      }
    },
  };
}
