import type { LandCoverStatus } from "./landcover-layer";

export function statusText(s: LandCoverStatus, visible: boolean): string {
  if (!visible) return "Hidden";
  if (s.state === "loading") return s.count > 0 ? `Updating… (${s.count} polygons shown)` : "Loading…";
  if (s.state === "error") return `Couldn't load land cover (${s.message ?? "unknown error"})`;
  const n = `${s.count} polygon${s.count === 1 ? "" : "s"}`;
  return s.truncated ? `${n} — view truncated, zoom in to see all` : n;
}
