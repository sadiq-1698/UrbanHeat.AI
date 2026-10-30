import type { ImageSource, MapLibreMap } from "maplibre-gl";
import { beforeLayerFor } from "./layer-order";
import type { ReadingMode } from "./stations";
import { type SurfaceMeta, type SurfaceMethod, imageCoordinates, parseSurfaceHeaders, surfaceUrl } from "./surface";

const SOURCE = "temperature-surface";
const LAYER = "temperature-surface";

export type SurfaceStatus = { state: "loading" } | { state: "ready"; meta: SurfaceMeta } | { state: "error"; message: string };

export interface SurfaceLayerOptions {
  region: string;
  mode: ReadingMode;
  method: SurfaceMethod;
  visible: boolean;
  opacity: number;
  onStatus: (s: SurfaceStatus) => void;
}

export interface SurfaceLayerHandle {
  setMode(mode: ReadingMode): void;
  setMethod(method: SurfaceMethod): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  refresh(): void;
  destroy(): void;
}

/** The API's JSON error body, if it sent one. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}`;
}

/**
 * The interpolated temperature surface (`/api/interpolate?format=png`) as a MapLibre image source over the
 * region. The PNG is fetched here (not by MapLibre) so the response headers (colour domain, method, cross-validated
 * error) can drive the legend and so errors, e.g. "no readings at that time", are shown instead of failing silently.
 * Nothing is requested while the layer is hidden; changes made while hidden apply when it is shown again.
 * The image is stretched between the region's corner coordinates in Mercator, which is a sub-pixel distortion at city scale.
 */
export function attachSurface(map: MapLibreMap, opts: SurfaceLayerOptions): SurfaceLayerHandle {
  let { mode, method, visible, opacity } = opts;
  let controller: AbortController | undefined;
  let objectUrl: string | undefined;
  let stale = true; // data on the map doesn't match the current mode/method
  let destroyed = false;

  async function load() {
    if (destroyed || !visible) return;
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    opts.onStatus({ state: "loading" });
    try {
      const res = await fetch(surfaceUrl(opts.region, mode, method), { signal: mine.signal });
      if (!res.ok) throw new Error(await errorMessage(res));
      const meta = parseSurfaceHeaders(res.headers);
      if (!meta) throw new Error("unexpected response from the interpolation service");
      const blob = await res.blob();
      if (mine.signal.aborted || destroyed) return;
      const url = URL.createObjectURL(blob);
      const coordinates = imageCoordinates(meta.bbox);
      const source = map.getSource(SOURCE) as ImageSource | undefined;
      if (source) source.updateImage({ url, coordinates });
      else {
        map.addSource(SOURCE, { type: "image", url, coordinates });
        map.addLayer(
          {
            id: LAYER,
            type: "raster",
            source: SOURCE,
            layout: { visibility: visible ? "visible" : "none" },
            paint: { "raster-opacity": opacity, "raster-fade-duration": 150, "raster-resampling": "linear" },
          },
          beforeLayerFor(map, "temperature-surface"),
        );
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl); // the previous image has been replaced
      objectUrl = url;
      stale = false;
      opts.onStatus({ state: "ready", meta });
    } catch (err) {
      if (mine.signal.aborted || destroyed) return;
      opts.onStatus({ state: "error", message: (err as Error).message });
    }
  }

  void load();

  return {
    setMode(next) {
      mode = next;
      stale = true;
      void load();
    },
    setMethod(next) {
      method = next;
      stale = true;
      void load();
    },
    setVisible(next) {
      visible = next;
      if (map.getLayer(LAYER)) map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
      if (visible && (stale || !map.getSource(SOURCE))) void load();
      if (!visible) controller?.abort();
    },
    setOpacity(next) {
      opacity = next;
      if (map.getLayer(LAYER)) map.setPaintProperty(LAYER, "raster-opacity", opacity);
    },
    refresh() {
      stale = true;
      void load();
    },
    destroy() {
      destroyed = true;
      controller?.abort();
      try {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {
        /* map already removed */
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
}
