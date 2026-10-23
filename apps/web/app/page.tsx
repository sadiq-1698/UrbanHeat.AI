"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";

import { MapView } from "@/components/MapView";
import { attachLandCover, type LandCoverStatus } from "@/lib/map/landcover-layer";
import { useRegions } from "@/lib/useRegions";
import styles from "./page.module.css";

export default function Home() {
  const regions = useRegions();
  const region = regions.status === "ready" ? regions.regions[0] : undefined;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [status, setStatus] = useState<LandCoverStatus>({ state: "loading", count: 0, truncated: false });

  const handleReady = useCallback((m: MapLibreMap) => {
    setMap(m);
    return () => setMap(null);
  }, []);

  useEffect(() => {
    if (!map || !region) return;
    const layer = attachLandCover(map, { region: region.id, opacity: 0.6, visible: true, onStatus: setStatus });
    return () => layer.destroy();
  }, [map, region]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>UrbanHeat.AI</h1>
        <span className={styles.subtitle}>
          Climate risk &amp; surface temperature{region ? ` · ${region.id}` : ""}
          {status.state === "ready" ? ` · ${status.count} land cover polygons` : ""}
        </span>
      </header>
      <main className={styles.main}>
        {regions.status === "error" ? (
          <div className={styles.message}>Couldn&apos;t load the region list ({regions.message}). Is the database running and migrated?</div>
        ) : regions.status === "ready" && !region ? (
          <div className={styles.message}>No regions loaded yet. Run the demo-city generator and loader (see db/ingest/README.md).</div>
        ) : (
          <MapView bounds={region?.bbox} onReady={handleReady} />
        )}
      </main>
    </div>
  );
}
