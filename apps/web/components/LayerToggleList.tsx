"use client";

import type { ReactNode } from "react";
import styles from "./LayerToggleList.module.css";

export interface LayerItem {
  id: string;
  label: string;
  visible: boolean;
  opacity: number;
  /** One line describing load state ("92 polygons", "Loading…"). */
  statusText: string;
  error?: boolean;
  /** Extra controls shown under the layer while it is visible (e.g. a reading selector). */
  controls?: ReactNode;
}

export interface LayerToggleListProps {
  items: LayerItem[];
  onVisibleChange: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onRetry: (id: string) => void;
}

/** One row per map layer: visibility checkbox, opacity slider, status line (with Retry on error), optional extras. */
export function LayerToggleList({ items, onVisibleChange, onOpacityChange, onRetry }: LayerToggleListProps) {
  return (
    <ul className={styles.list}>
      {items.map((it) => (
        <li key={it.id} className={styles.item}>
          <div className={styles.head}>
            <label>
              <input type="checkbox" checked={it.visible} onChange={(e) => onVisibleChange(it.id, e.target.checked)} />
              {it.label}
            </label>
          </div>
          <input
            className={styles.slider}
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={it.opacity}
            disabled={!it.visible}
            onChange={(e) => onOpacityChange(it.id, Number(e.target.value))}
            aria-label={`${it.label} opacity`}
          />
          <div className={`${styles.status} ${it.error && it.visible ? styles.error : ""}`} role="status" aria-live="polite">
            {it.statusText}
            {it.error && it.visible && (
              <button type="button" className={styles.retry} onClick={() => onRetry(it.id)}>
                Retry
              </button>
            )}
          </div>
          {it.visible && it.controls ? <div className={styles.extra}>{it.controls}</div> : null}
        </li>
      ))}
    </ul>
  );
}
