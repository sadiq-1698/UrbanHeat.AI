"use client";

import { METHOD_LABELS, type SurfaceMethod, accuracyNote, methodSummary } from "@/lib/map/surface";
import type { SurfaceStatus } from "@/lib/map/surface-layer";
import styles from "./SurfaceControls.module.css";

export interface SurfaceControlsProps {
  method: SurfaceMethod;
  onMethodChange: (m: SurfaceMethod) => void;
  status: SurfaceStatus;
}

/** Interpolation method picker, plus what the server actually used and how accurate it is. */
export function SurfaceControls({ method, onMethodChange, status }: SurfaceControlsProps) {
  return (
    <div className={styles.grid}>
      <label className={styles.field}>
        <span>Method</span>
        <select className={styles.select} aria-label="Interpolation method" value={method} onChange={(e) => onMethodChange(e.target.value as SurfaceMethod)}>
          {(Object.keys(METHOD_LABELS) as SurfaceMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {status.state === "ready" && (
        <>
          <p className={styles.note}>{methodSummary(status.meta)}</p>
          <p className={styles.note}>{accuracyNote(status.meta)}</p>
          {status.meta.waterMaskedCells > 0 && <p className={styles.note}>Open water is left empty.</p>}
        </>
      )}
    </div>
  );
}

export function HeatmapNote() {
  return (
    <p className={styles.note}>
      Station density weighted by temperature: it shows where hot stations cluster, not an estimated temperature. Use the temperature surface for estimates.
    </p>
  );
}
