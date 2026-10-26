import type { LandCoverStatus } from "./landcover-layer";
import type { StationsStatus } from "./stations-layer";

export function statusText(s: LandCoverStatus, visible: boolean): string {
  if (!visible) return "Hidden";
  if (s.state === "loading") return s.count > 0 ? `Updating… (${s.count} polygons shown)` : "Loading…";
  if (s.state === "error") return `Couldn't load land cover (${s.message ?? "unknown error"})`;
  const n = `${s.count} polygon${s.count === 1 ? "" : "s"}`;
  return s.truncated ? `${n} — view truncated, zoom in to see all` : n;
}


export function stationsStatusText(s: StationsStatus, visible: boolean): string {
  if (!visible) return "Hidden";
  if (s.state === "loading") return "Loading…";
  if (s.state === "error") return `Couldn't load stations (${s.message ?? "unknown error"})`;
  if (s.count === 0) return "No stations in this region";
  const noun = `station${s.count === 1 ? "" : "s"}`;
  return s.withReading === s.count ? `${s.count} ${noun}` : `${s.withReading} of ${s.count} ${noun} have a reading`;
}
