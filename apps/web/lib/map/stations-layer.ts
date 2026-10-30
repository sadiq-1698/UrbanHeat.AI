import type { FeatureCollection, Point } from "geojson";
import { GeoJSONSource, type MapLayerMouseEvent, type MapLibreMap } from "maplibre-gl";
import { INTENSITY_EXPRESSION, RADIUS_EXPRESSION, colorExpression as heatColors, weightExpression } from "./heatmap";
import { beforeLayerFor } from "./layer-order";
import { closePopup, openPopup } from "./popup";
import { type ReadingMode, stationPopup, stationsUrl } from "./stations";
import { type Domain, colorExpression, niceDomain } from "./temperature";

const SOURCE = "stations";
export const STATIONS_CIRCLE = "stations-circle";
const LABEL = "stations-label";
const HEATMAP = "station-heatmap";

export interface StationsStatus {
  state: "loading" | "ready" | "error";
  /** Stations returned. */
  count: number;
  /** Of those, how many have a reading for the chosen mode. */
  withReading: number;
  /** Color-scale domain derived from the current readings. */
  domain: Domain;
  message?: string;
}

export interface StationsLayerOptions {
  region: string;
  mode: ReadingMode;
  visible: boolean;
  opacity: number;
  /** The kernel-density heat map drawn from the same station data. */
  heatmapVisible: boolean;
  heatmapOpacity: number;
  onStatus: (s: StationsStatus) => void;
}

export interface StationsLayerHandle {
  setMode(mode: ReadingMode): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  /** Use this colour domain (e.g. the temperature surface's, so both layers share one scale); null = derive from the readings. */
  setDomain(domain: Domain | null): void;
  setHeatmapVisible(visible: boolean): void;
  setHeatmapOpacity(opacity: number): void;
  refresh(): void;
  destroy(): void;
}

type Props = Record<string, unknown>;

/**
 * Weather stations as temperature-colored circles (plus value labels when zoomed in and the basemap
 * provides glyphs), with hover and click popups. Loads the whole region once per reading mode:
 * a region has tens to a few thousand stations, unlike land cover it isn't worth viewport-chunking.
 */
export function attachStations(map: MapLibreMap, opts: StationsLayerOptions): StationsLayerHandle {
  let mode = opts.mode;
  let visible = opts.visible;
  let opacity = opts.opacity;
  let heatVisible = opts.heatmapVisible;
  let heatOpacity = opts.heatmapOpacity;
  let domain = niceDomain([]);
  let override: Domain | null = null;
  const applyDomain = () => {
    const d = override ?? domain;
    map.setPaintProperty(STATIONS_CIRCLE, "circle-color", colorExpression(d) as never);
    map.setPaintProperty(HEATMAP, "heatmap-weight", weightExpression(d) as never);
  };
  let controller: AbortController | undefined;
  let hoveredId: string | number | undefined;
  let destroyed = false;

  const vis = () => (visible ? "visible" : "none");
  const empty: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
  map.addSource(SOURCE, { type: "geojson", data: empty, promoteId: "station_id" });
  // Kernel-density heat map on the same source (so both layers always show the same readings); it sits under
  // the circles and under the basemap labels (see layer-order.ts).
  map.addLayer(
    {
      id: HEATMAP,
      type: "heatmap",
      source: SOURCE,
      layout: { visibility: heatVisible ? "visible" : "none" },
      paint: {
        "heatmap-weight": weightExpression(domain) as never,
        "heatmap-radius": RADIUS_EXPRESSION as never,
        "heatmap-intensity": INTENSITY_EXPRESSION as never,
        "heatmap-color": heatColors() as never,
        "heatmap-opacity": heatOpacity,
      },
    },
    beforeLayerFor(map, "station-heatmap"),
  );
  map.addLayer({
    id: STATIONS_CIRCLE,
    type: "circle",
    source: SOURCE,
    layout: { visibility: vis() },
    paint: {
      "circle-color": colorExpression(domain) as never,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 7, 15, 10, 18, 13],
      "circle-stroke-color": "#2b2f36",
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 3, 1.25],
      "circle-opacity": opacity,
      "circle-stroke-opacity": opacity,
    },
  });
  // Value labels need glyphs; the offline fallback style has none, so skip them there.
  const hasGlyphs = Boolean(map.getStyle().glyphs);
  if (hasGlyphs) {
    map.addLayer({
      id: LABEL,
      type: "symbol",
      source: SOURCE,
      minzoom: 11,
      layout: {
        visibility: vis(),
        "text-field": ["case", ["==", ["typeof", ["get", "temp_c"]], "number"], ["number-format", ["get", "temp_c"], { "min-fraction-digits": 1, "max-fraction-digits": 1 }], ""],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, 1.6],
        "text-allow-overlap": false,
      },
      paint: { "text-color": "#1b1f24", "text-halo-color": "#ffffff", "text-halo-width": 1.5, "text-opacity": opacity },
    });
  }

  async function load() {
    if (destroyed) return;
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    opts.onStatus({ state: "loading", count: 0, withReading: 0, domain });
    try {
      const res = await fetch(stationsUrl(opts.region, mode), { signal: mine.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = (await res.json()) as FeatureCollection<Point>;
      if (mine.signal.aborted || destroyed) return;
      const temps = fc.features.map((f) => (f.properties as Props | null)?.temp_c as number | null);
      domain = niceDomain(temps);
      applyDomain();
      (map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      opts.onStatus({ state: "ready", count: fc.features.length, withReading: temps.filter((t) => typeof t === "number").length, domain });
    } catch (err) {
      if (mine.signal.aborted || destroyed) return;
      opts.onStatus({ state: "error", count: 0, withReading: 0, domain, message: (err as Error).message });
    }
  }

  const setHover = (id: string | number | undefined) => {
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
    openPopup(map, e.lngLat, stationPopup(f.properties ?? {}, mode));
  };
  map.on("mousemove", STATIONS_CIRCLE, onMove);
  map.on("mouseleave", STATIONS_CIRCLE, onLeave);
  map.on("click", STATIONS_CIRCLE, onClick);
  void load();

  return {
    setMode(next) {
      mode = next;
      closePopup(map); // its text describes the previous mode
      void load();
    },
    setVisible(next) {
      visible = next;
      map.setLayoutProperty(STATIONS_CIRCLE, "visibility", vis());
      if (hasGlyphs) map.setLayoutProperty(LABEL, "visibility", vis());
    },
    setOpacity(next) {
      opacity = next;
      map.setPaintProperty(STATIONS_CIRCLE, "circle-opacity", opacity);
      map.setPaintProperty(STATIONS_CIRCLE, "circle-stroke-opacity", opacity);
      if (hasGlyphs) map.setPaintProperty(LABEL, "text-opacity", opacity);
    },
    setDomain(next) {
      override = next;
      applyDomain();
    },
    setHeatmapVisible(next) {
      heatVisible = next;
      map.setLayoutProperty(HEATMAP, "visibility", heatVisible ? "visible" : "none");
    },
    setHeatmapOpacity(next) {
      heatOpacity = next;
      map.setPaintProperty(HEATMAP, "heatmap-opacity", heatOpacity);
    },
    refresh() {
      void load();
    },
    destroy() {
      destroyed = true;
      controller?.abort();
      map.off("mousemove", STATIONS_CIRCLE, onMove);
      map.off("mouseleave", STATIONS_CIRCLE, onLeave);
      map.off("click", STATIONS_CIRCLE, onClick);
      try {
        for (const id of [LABEL, STATIONS_CIRCLE, HEATMAP]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {
        /* map already removed */
      }
    },
  };
}
