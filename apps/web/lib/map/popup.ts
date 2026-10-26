import { type MapLibreMap, Popup } from "maplibre-gl";

export interface PopupContent {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string }[];
}

// One popup per map: clicking a station on top of a land cover polygon (or another layer) replaces the
// previous popup instead of stacking a second one.
const open = new WeakMap<MapLibreMap, Popup>();

/** Show a popup at `lngLat`, built from DOM nodes with textContent (feature data never goes through innerHTML). */
export function openPopup(map: MapLibreMap, lngLat: { lng: number; lat: number }, c: PopupContent): void {
  const root = document.createElement("div");
  const h = document.createElement("strong");
  h.textContent = c.title;
  root.append(h);
  if (c.subtitle) {
    const sub = document.createElement("div");
    sub.style.opacity = "0.7";
    sub.textContent = c.subtitle;
    root.append(sub);
  }
  for (const r of c.rows) {
    const line = document.createElement("div");
    line.textContent = `${r.label}: ${r.value}`;
    root.append(line);
  }
  open.get(map)?.remove();
  open.set(map, new Popup({ maxWidth: "260px" }).setLngLat(lngLat).setDOMContent(root).addTo(map));
}

export function closePopup(map: MapLibreMap): void {
  open.get(map)?.remove();
  open.delete(map);
}
