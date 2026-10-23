// Free, no-API-key vector basemap (OpenFreeMap, https://openfreemap.org). "positron" is a pale
// grayscale style, so analysis layers (land cover, heat) read clearly on top of it. Attribution
// comes from the style itself via MapLibre's default AttributionControl.
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// Used when the basemap can't be fetched (offline, blocked): data layers still render on a blank map.
export const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": "#eef1f4" } }],
};
