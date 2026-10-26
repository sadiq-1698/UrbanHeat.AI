"use client";

import { type Agg, type ReadingMode, defaultMode, latestDay, pad2, withAgg, withDate, withHour } from "@/lib/map/stations";
import styles from "./ReadingControls.module.css";

export interface ReadingControlsProps {
  mode: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  /** UTC days that have readings; empty/undefined means only "Latest" is available. */
  days: readonly string[] | undefined;
}

const KIND_LABEL: Record<ReadingMode["kind"], string> = { latest: "Latest reading", hour: "Specific hour", day: "Daily summary" };

/** Chooses which reading the station circles show: latest, one UTC hour, or a daily max/mean/min. */
export function ReadingControls({ mode, onChange, days }: ReadingControlsProps) {
  const hasDays = (days?.length ?? 0) > 0;
  const day = mode.kind === "latest" ? latestDay(days ?? []) : mode.date;
  return (
    <div className={styles.grid}>
      <label className={styles.field}>
        <span>Reading</span>
        <select
          className={styles.select}
          aria-label="Reading"
          value={mode.kind}
          onChange={(e) => onChange(defaultMode(e.target.value as ReadingMode["kind"], day, mode.kind === "day" ? mode.agg : "max"))}
        >
          <option value="latest">{KIND_LABEL.latest}</option>
          {hasDays && <option value="hour">{KIND_LABEL.hour}</option>}
          {hasDays && <option value="day">{KIND_LABEL.day}</option>}
        </select>
      </label>

      {mode.kind !== "latest" && (
        <label className={styles.field}>
          <span>Day (UTC)</span>
          <select className={styles.select} aria-label="Day (UTC)" value={mode.date} onChange={(e) => onChange(withDate(mode, e.target.value))}>
            {(days ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode.kind === "hour" && (
        <label className={styles.field}>
          <span>Hour (UTC): {pad2(mode.hour)}:00</span>
          <input className={styles.slider} type="range" min={0} max={23} step={1} value={mode.hour} onChange={(e) => onChange(withHour(mode, Number(e.target.value)))} aria-label="Hour of day (UTC)" />
        </label>
      )}

      {mode.kind === "day" && (
        <label className={styles.field}>
          <span>Summary</span>
          <select className={styles.select} aria-label="Summary" value={mode.agg} onChange={(e) => onChange(withAgg(mode, e.target.value as Agg))}>
            <option value="max">Daily max</option>
            <option value="mean">Daily mean</option>
            <option value="min">Daily min</option>
          </select>
        </label>
      )}
    </div>
  );
}
