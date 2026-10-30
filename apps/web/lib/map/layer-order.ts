/**
 * Bottom-to-top stacking of our analysis layers. Each controller adds its layers with
 * `beforeLayerFor(map, id)`, so the final order is the same whichever effect runs first.
 * Everything except stations sits *under* the basemap's labels (the first `symbol` layer).
 */
export const LAYER_ORDER = [
  "raster-overlay",
  "land-cover-fill",
  "land-cover-line",
  "temperature-surface",
  "station-heatmap",
  "stations-circle",
  "stations-label",
] as const;

export type OurLayerId = (typeof LAYER_ORDER)[number];

/** Layers that stay above the basemap's labels (points the user must be able to read and click). */
const ABOVE_LABELS = new Set<string>(["stations-circle", "stations-label"]);

interface MapLike {
  getLayer(id: string): unknown;
  getStyle(): { layers: { id: string; type: string }[] };
}

/**
 * The layer id to pass as `before` to `map.addLayer` so that `id` lands in its slot: directly under the
 * nearest higher layer of ours that already exists, otherwise under the basemap labels (or on top, for
 * layers that stay above labels).
 */
export function beforeLayerFor(map: MapLike, id: OurLayerId): string | undefined {
  const aboveLabels = ABOVE_LABELS.has(id);
  const start = LAYER_ORDER.indexOf(id);
  for (const higher of LAYER_ORDER.slice(start + 1)) {
    // A layer meant to sit under the labels must not be slotted beneath a station layer that is above them.
    if (!aboveLabels && ABOVE_LABELS.has(higher)) break;
    if (map.getLayer(higher)) return higher;
  }
  if (aboveLabels) return undefined;
  const label = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  if (label) return label;
  // No basemap labels (offline fallback style): still stay beneath the station layers if they exist.
  return LAYER_ORDER.find((l) => ABOVE_LABELS.has(l) && map.getLayer(l));
}
