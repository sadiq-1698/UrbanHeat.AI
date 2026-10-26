"use client";

import type { ReactNode } from "react";
import type { Region } from "@/lib/useRegions";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  regions: Region[];
  regionId: string;
  onRegionChange: (id: string) => void;
  /** Layer toggles and per-layer controls. */
  layers: ReactNode;
  /** One legend block per visible layer. */
  legends: { title: string; body: ReactNode }[];
  className?: string;
}

export function Sidebar({ regions, regionId, onRegionChange, layers, legends, className }: SidebarProps) {
  const region = regions.find((r) => r.id === regionId);
  return (
    <aside className={`${styles.sidebar} ${className ?? ""}`} aria-label="Map controls">
      <section className={styles.section}>
        <h2>Region</h2>
        {regions.length > 1 ? (
          <select className={styles.select} value={regionId} onChange={(e) => onRegionChange(e.target.value)} aria-label="Region">
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        ) : (
          <div className={styles.row}>{regionId}</div>
        )}
        {region?.synthetic && (
          <p className={styles.note}>
            <span className={styles.badge}>Synthetic data</span> Generated demo city — patterns are plausible, not measured.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Layers</h2>
        {layers}
      </section>

      {legends.map((l) => (
        <section key={l.title} className={styles.section}>
          <h2>{l.title}</h2>
          {l.body}
        </section>
      ))}
    </aside>
  );
}
