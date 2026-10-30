import { GeoJSONSource, type MapLayerMouseEvent, type MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { type BBox, bboxContains, padBBox, viewportToBBox } from "./geo";
import { colorExpression, landCoverUrl, popupRows, zoomBucket } from "./landcover";
import { beforeLayerFor } from "./layer-order";
import { closePopup, openPopup } from "./popup";

const SOURCE = "land-cover";
const FILL = "land-cover-fill";
const LINE = "land-cover-line";
const DEBOUNCE_MS = 250;
/** Fetch this much extra around the viewport so small pans don't trigger a request. */
const FETCH_PAD = 0.25;

export interface LandCoverStatus {
  state: "loading" | "ready" | "error";
  count: number;
  truncated: boolean;
  message?: string;
}

export interface LandCoverLayerOptions {
  region: string;
  opacity: number;
  visible: boolean;
  onStatus: (status: LandCoverStatus) => void;
}

export interface LandCoverLayerHandle {
  /** Re-fetch the current view even if it was already loaded (e.g. "Retry" after an error). */
  refresh(): void;
  setOpacity(opacity: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Owns the land cover source/layers on `map`: loads polygons for the current viewport (debounced,
 * padded, cancelling superseded requests), re-fetches when the view leaves the loaded area or the
 * zoom bucket changes, and shows a popup on click. Everything is removed again by `destroy()`.
 */
export function attachLandCover(map: MapLibreMap, opts: LandCoverLayerOptions): LandCoverLayerHandle {
  let opacity = opts.opacity;
  let visible = opts.visible;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let loaded: { bbox: BBox; bucket: number } | undefined;
  let hoveredId: number | string | undefined;
  let destroyed = false;

  const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
  map.addSource(SOURCE, { type: "geojson", data: empty, promoteId: "id" });
  map.addLayer(
    {
      id: FILL,
      type: "fill",
      source: SOURCE,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "fill-color": colorExpression() as never,
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], Math.min(opacity + 0.2, 1), opacity],
      },
    },
    beforeLayerFor(map, "land-cover-fill"),
  );
  map.addLayer(
    {
      id: LINE,
      type: "line",
      source: SOURCE,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.55,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.2, 14, 1],
      },
    },
    beforeLayerFor(map, "land-cover-line"),
  );

  const applyOpacity = () => {
    map.setPaintProperty(FILL, "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], Math.min(opacity + 0.2, 1), opacity]);
  };
  const applyVisibility = () => {
    const v = visible ? "visible" : "none";
    map.setLayoutProperty(FILL, "visibility", v);
    map.setLayoutProperty(LINE, "visibility", v);
  };

  async function load() {
    if (destroyed || !visible) return;
    const view = viewportToBBox(map.getBounds());
    const bucket = zoomBucket(map.getZoom());
    if (loaded && loaded.bucket === bucket && bboxContains(loaded.bbox, view)) return;

    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    const bbox = padBBox(view, FETCH_PAD);
    opts.onStatus({ state: "loading", count: loaded ? currentCount() : 0, truncated: false });
    try {
      const res = await fetch(landCoverUrl({ bbox, region: opts.region, zoom: map.getZoom() }), { signal: mine.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = (await res.json()) as FeatureCollection & { truncated?: boolean };
      if (mine.signal.aborted || destroyed) return;
      (map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      // A truncated response doesn't cover the whole padded box, so don't treat it as loaded:
      // the next move (or zoom) retries instead of leaving a silent hole.
      loaded = fc.truncated ? undefined : { bbox, bucket };
      count = fc.features.length;
      opts.onStatus({ state: "ready", count, truncated: Boolean(fc.truncated) });
    } catch (err) {
      if (mine.signal.aborted || destroyed) return;
      opts.onStatus({ state: "error", count: 0, truncated: false, message: (err as Error).message });
    }
  }
  let count = 0;
  const currentCount = () => count;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(load, DEBOUNCE_MS);
  };

  const setHover = (id: number | string | undefined) => {
    if (hoveredId !== undefined) map.setFeatureState({ source: SOURCE, id: hoveredId }, { hover: false });
    hoveredId = id;
    if (id !== undefined) map.setFeatureState({ source: SOURCE, id }, { hover: true });
  };
  const onMove = (e: MapLayerMouseEvent) => {
    map.getCanvas().style.cursor = "pointer";
    setHover(e.features?.[0]?.id);
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = "";
    setHover(undefined);
  };
  const onClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    // A station drawn on top of this polygon owns the click.
    if (map.getLayer("stations-circle") && map.queryRenderedFeatures(e.point, { layers: ["stations-circle"] }).length > 0) return;
    openPopup(map, e.lngLat, popupRows(f.properties ?? {}));
  };

  map.on("moveend", schedule);
  map.on("mousemove", FILL, onMove);
  map.on("mouseleave", FILL, onLeave);
  map.on("click", FILL, onClick);
  void load();

  return {
    refresh() {
      loaded = undefined;
      void load();
    },
    setOpacity(next) {
      opacity = next;
      applyOpacity();
    },
    setVisible(next) {
      visible = next;
      applyVisibility();
      if (visible) void load(); // may have panned while hidden
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      controller?.abort();
      closePopup(map);
      map.off("moveend", schedule);
      map.off("mousemove", FILL, onMove);
      map.off("mouseleave", FILL, onLeave);
      map.off("click", FILL, onClick);
      // The map may already be torn down (React unmount order); only touch it if it still has the layers.
      try {
        if (map.getLayer(LINE)) map.removeLayer(LINE);
        if (map.getLayer(FILL)) map.removeLayer(FILL);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {
        /* map already removed */
      }
    },
  };
}
