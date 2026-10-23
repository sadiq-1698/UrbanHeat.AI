"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";

import { MapView } from "@/components/MapView";
import { Sidebar } from "@/components/Sidebar";
import { attachLandCover, type LandCoverLayerHandle, type LandCoverStatus } from "@/lib/map/landcover-layer";
import { useRegions } from "@/lib/useRegions";
import styles from "./page.module.css";

const INITIAL_STATUS: LandCoverStatus = { state: "loading", count: 0, truncated: false };

export default function Home() {
  const regions = useRegions();
  const [regionId, setRegionId] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.6);
  const [status, setStatus] = useState<LandCoverStatus>(INITIAL_STATUS);
  const layerRef = useRef<LandCoverLayerHandle | null>(null);
  // Latest control values, read when the layer is (re)created without re-creating it on every slider tick.
  const controls = useRef({ visible, opacity });
  controls.current = { visible, opacity };

  const list = regions.status === "ready" ? regions.regions : [];
  const region = list.find((r) => r.id === regionId) ?? list[0];

  const handleReady = useCallback((m: MapLibreMap) => {
    setMap(m);
    return () => setMap(null);
  }, []);

  const regionKey = region?.id;
  useEffect(() => {
    if (!map || !regionKey) return;
    setStatus(INITIAL_STATUS);
    const layer = attachLandCover(map, { region: regionKey, ...controls.current, onStatus: setStatus });
    layerRef.current = layer;
    return () => {
      layer.destroy();
      layerRef.current = null;
    };
  }, [map, regionKey]);

  useEffect(() => layerRef.current?.setVisible(visible), [visible]);
  useEffect(() => layerRef.current?.setOpacity(opacity), [opacity]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>UrbanHeat.AI</h1>
        <span className={styles.subtitle}>Climate risk &amp; surface temperature</span>
      </header>
      {regions.status === "error" ? (
        <div className={styles.message}>Couldn&apos;t load the region list ({regions.message}). Is the database running and migrated?</div>
      ) : regions.status === "ready" && !region ? (
        <div className={styles.message}>No regions loaded yet. Run the demo-city generator and loader (see db/ingest/README.md).</div>
      ) : (
        <div className={styles.body}>
          <Sidebar
            regions={list}
            regionId={region?.id ?? ""}
            onRegionChange={setRegionId}
            landCoverVisible={visible}
            onLandCoverVisible={setVisible}
            landCoverOpacity={opacity}
            onLandCoverOpacity={setOpacity}
            status={status}
            onRetry={() => layerRef.current?.refresh()}
          />
          <div className={styles.mapPane}>
            <MapView bounds={region?.bbox} onReady={handleReady} />
          </div>
        </div>
      )}
    </div>
  );
}
