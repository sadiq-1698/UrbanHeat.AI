export type Agg = "max" | "mean" | "min";

/** Which reading each station shows. Times are UTC (the API's convention). */
export type ReadingMode =
  | { kind: "latest" }
  | { kind: "hour"; date: string; hour: number }
  | { kind: "day"; date: string; agg: Agg };

export const LATEST: ReadingMode = { kind: "latest" };

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const hourToIso = (date: string, hour: number): string => `${date}T${pad2(hour)}:00:00Z`;

/** The query parameters that select a reading; shared by /api/stations and /api/interpolate. */
export function readingParams(mode: ReadingMode): [string, string][] {
  if (mode.kind === "hour") return [["at", hourToIso(mode.date, mode.hour)]];
  if (mode.kind === "day") return [["date", mode.date], ["agg", mode.agg]];
  return [];
}

export function stationsUrl(region: string, mode: ReadingMode): string {
  const p = new URLSearchParams({ region, limit: "5000" });
  for (const [k, v] of readingParams(mode)) p.set(k, v);
  return `/api/stations?${p}`;
}

const AGG_LABEL: Record<Agg, string> = { max: "Daily max", mean: "Daily mean", min: "Daily min" };

export function describeMode(mode: ReadingMode): string {
  if (mode.kind === "latest") return "Latest reading";
  if (mode.kind === "hour") return `${mode.date} ${pad2(mode.hour)}:00 UTC`;
  return `${AGG_LABEL[mode.agg]}, ${mode.date} (UTC)`;
}

/** Mode used when the user switches kind: keep the day, pick a sensible hour (mid-afternoon local-ish: 22 UTC). */
export function defaultMode(kind: ReadingMode["kind"], day: string | undefined, agg: Agg = "max"): ReadingMode {
  if (kind === "latest" || !day) return LATEST;
  return kind === "hour" ? { kind: "hour", date: day, hour: 22 } : { kind: "day", date: day, agg };
}

export interface PopupRow {
  label: string;
  value: string;
}

const num = (v: unknown, digits: number, unit: string) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : "—");

export function stationPopup(p: Record<string, unknown>, mode: ReadingMode): { title: string; subtitle: string; rows: PopupRow[] } {
  const hasReading = typeof p.temp_c === "number";
  const nObs = typeof p.n_obs === "number" ? p.n_obs : 0;
  const when =
    mode.kind === "day"
      ? `${describeMode(mode)} · ${nObs} reading${nObs === 1 ? "" : "s"}`
      : typeof p.observed_at === "string"
        ? `${p.observed_at.slice(0, 16).replace("T", " ")} UTC`
        : describeMode(mode);
  return {
    title: String(p.name ?? p.station_id ?? "Station"),
    subtitle: hasReading ? when : `No reading for: ${describeMode(mode)}`,
    rows: [
      { label: "Temperature", value: num(p.temp_c, 1, " °C") },
      { label: "Humidity", value: num(p.humidity_pct, 0, "%") },
      { label: "Wind", value: num(p.wind_ms, 1, " m/s") },
      { label: "Elevation", value: num(p.elevation_m, 0, " m") },
      { label: "Source", value: String(p.source ?? "—") },
    ],
  };
}

/** Same mode on another day (latest has no day, so it is unchanged). */
export function withDate(mode: ReadingMode, date: string): ReadingMode {
  return mode.kind === "latest" ? mode : { ...mode, date };
}

export function withHour(mode: ReadingMode, hour: number): ReadingMode {
  return mode.kind === "hour" ? { ...mode, hour: Math.min(Math.max(Math.round(hour), 0), 23) } : mode;
}

export function withAgg(mode: ReadingMode, agg: Agg): ReadingMode {
  return mode.kind === "day" ? { ...mode, agg } : mode;
}

/** The day to preselect for a region: its most recent day with readings. */
export const latestDay = (days: readonly string[]): string | undefined => days.at(-1);
