"use client";

import { LAND_COVER_ORDER, LAND_COVER_STYLES } from "@/lib/map/landcover";
import type { LandCoverStatus } from "@/lib/map/landcover-layer";
import { statusText } from "@/lib/map/status";
import type { Region } from "@/lib/useRegions";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  regions: Region[];
  regionId: string;
  onRegionChange: (id: string) => void;
  landCoverVisible: boolean;
  onLandCoverVisible: (visible: boolean) => void;
  landCoverOpacity: number;
  onLandCoverOpacity: (opacity: number) => void;
  status: LandCoverStatus;
  onRetry: () => void;
  className?: string;
}

export function Sidebar(p: SidebarProps) {
  const region = p.regions.find((r) => r.id === p.regionId);
  return (
    <aside className={`${styles.sidebar} ${p.className ?? ""}`} aria-label="Map controls">
      <section className={styles.section}>
        <h2>Region</h2>
        {p.regions.length > 1 ? (
          <select className={styles.select} value={p.regionId} onChange={(e) => p.onRegionChange(e.target.value)} aria-label="Region">
            {p.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        ) : (
          <div className={styles.row}>{p.regionId}</div>
        )}
        {region?.synthetic && (
          <p className={styles.note}>
            <span className={styles.badge}>Synthetic data</span> Generated demo city — patterns are plausible, not measured.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Layers</h2>
        <div className={styles.row}>
          <label>
            <input type="checkbox" checked={p.landCoverVisible} onChange={(e) => p.onLandCoverVisible(e.target.checked)} />
            Land cover
          </label>
        </div>
        <div className={styles.row}>
          <input
            className={styles.slider}
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={p.landCoverOpacity}
            disabled={!p.landCoverVisible}
            onChange={(e) => p.onLandCoverOpacity(Number(e.target.value))}
            aria-label="Land cover opacity"
          />
        </div>
        <div className={`${styles.status} ${p.status.state === "error" && p.landCoverVisible ? styles.statusError : ""}`} role="status" aria-live="polite">
          {statusText(p.status, p.landCoverVisible)}
          {p.status.state === "error" && p.landCoverVisible && (
            <button type="button" className={styles.retry} onClick={p.onRetry}>
              Retry
            </button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Land cover</h2>
        <ul className={styles.legend}>
          {LAND_COVER_ORDER.map((c) => (
            <li key={c}>
              <span className={styles.swatch} style={{ background: LAND_COVER_STYLES[c].color }} />
              {LAND_COVER_STYLES[c].label}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
