"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";

import { LandCoverLegend, TemperatureLegend } from "@/components/Legend";
import { LayerToggleList } from "@/components/LayerToggleList";
import { MapView } from "@/components/MapView";
import { ReadingControls } from "@/components/ReadingControls";
import { Sidebar } from "@/components/Sidebar";
import { attachLandCover, type LandCoverLayerHandle, type LandCoverStatus } from "@/lib/map/landcover-layer";
import { statusText, stationsStatusText } from "@/lib/map/status";
import { LATEST, type ReadingMode } from "@/lib/map/stations";
import { attachStations, type StationsLayerHandle, type StationsStatus } from "@/lib/map/stations-layer";
import { niceDomain } from "@/lib/map/temperature";
import { useRegions } from "@/lib/useRegions";
import { useStationsRange } from "@/lib/useStationsRange";
import styles from "./page.module.css";

type LayerId = "stations" | "landcover";

const LAND_COVER_LOADING: LandCoverStatus = { state: "loading", count: 0, truncated: false };
const STATIONS_LOADING: StationsStatus = { state: "loading", count: 0, withReading: 0, domain: niceDomain([]) };

export default function Home() {
  const regions = useRegions();
  const [regionId, setRegionId] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [visible, setVisible] = useState<Record<LayerId, boolean>>({ stations: true, landcover: true });
  const [opacity, setOpacity] = useState<Record<LayerId, number>>({ stations: 1, landcover: 0.6 });
  const [mode, setMode] = useState<ReadingMode>(LATEST);
  const [landStatus, setLandStatus] = useState<LandCoverStatus>(LAND_COVER_LOADING);
  const [stationStatus, setStationStatus] = useState<StationsStatus>(STATIONS_LOADING);
  const landRef = useRef<LandCoverLayerHandle | null>(null);
  const stationsRef = useRef<StationsLayerHandle | null>(null);
  // Latest control values, read when a layer is (re)created, so slider ticks don't re-create layers.
  const live = useRef({ visible, opacity, mode });
  live.current = { visible, opacity, mode };

  const list = regions.status === "ready" ? regions.regions : [];
  const region = list.find((r) => r.id === regionId) ?? list[0];
  const regionKey = region?.id;
  const rangeState = useStationsRange(regionKey);
  const days = rangeState.status === "ready" ? rangeState.range.days : undefined;

  const handleReady = useCallback((m: MapLibreMap) => {
    setMap(m);
    return () => setMap(null);
  }, []);

  // A different region has different days/readings: start from "latest" again.
  useEffect(() => setMode(LATEST), [regionKey]);

  useEffect(() => {
    if (!map || !regionKey) return;
    setLandStatus(LAND_COVER_LOADING);
    const layer = attachLandCover(map, { region: regionKey, visible: live.current.visible.landcover, opacity: live.current.opacity.landcover, onStatus: setLandStatus });
    landRef.current = layer;
    return () => {
      layer.destroy();
      landRef.current = null;
    };
  }, [map, regionKey]);

  useEffect(() => {
    if (!map || !regionKey) return;
    setStationStatus(STATIONS_LOADING);
    const layer = attachStations(map, {
      region: regionKey,
      mode: live.current.mode,
      visible: live.current.visible.stations,
      opacity: live.current.opacity.stations,
      onStatus: setStationStatus,
    });
    stationsRef.current = layer;
    return () => {
      layer.destroy();
      stationsRef.current = null;
    };
  }, [map, regionKey]);

  useEffect(() => landRef.current?.setVisible(visible.landcover), [visible.landcover]);
  useEffect(() => landRef.current?.setOpacity(opacity.landcover), [opacity.landcover]);
  useEffect(() => stationsRef.current?.setVisible(visible.stations), [visible.stations]);
  useEffect(() => stationsRef.current?.setOpacity(opacity.stations), [opacity.stations]);
  useEffect(() => stationsRef.current?.setMode(mode), [mode]);

  const items = [
    {
      id: "stations",
      label: "Weather stations",
      visible: visible.stations,
      opacity: opacity.stations,
      statusText: stationsStatusText(stationStatus, visible.stations),
      error: stationStatus.state === "error",
      controls: <ReadingControls mode={mode} onChange={setMode} days={days} />,
    },
    {
      id: "landcover",
      label: "Land cover",
      visible: visible.landcover,
      opacity: opacity.landcover,
      statusText: statusText(landStatus, visible.landcover),
      error: landStatus.state === "error",
    },
  ];

  const legends = [
    ...(visible.stations
      ? [{ title: "Temperature", body: <TemperatureLegend domain={stationStatus.domain} hasMissing={stationStatus.state === "ready" && stationStatus.withReading < stationStatus.count} /> }]
      : []),
    ...(visible.landcover ? [{ title: "Land cover", body: <LandCoverLegend /> }] : []),
  ];

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
            layers={
              <LayerToggleList
                items={items}
                onVisibleChange={(id, v) => setVisible((s) => ({ ...s, [id as LayerId]: v }))}
                onOpacityChange={(id, o) => setOpacity((s) => ({ ...s, [id as LayerId]: o }))}
                onRetry={(id) => (id === "stations" ? stationsRef.current : landRef.current)?.refresh()}
              />
            }
            legends={legends}
          />
          <div className={styles.mapPane}>
            <MapView bounds={region?.bbox} onReady={handleReady} />
          </div>
        </div>
      )}
    </div>
  );
}
