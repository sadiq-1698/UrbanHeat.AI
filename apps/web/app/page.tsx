"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";

import { LandCoverLegend, RasterLegend, TemperatureLegend } from "@/components/Legend";
import { LayerToggleList, type LayerItem } from "@/components/LayerToggleList";
import { MapView } from "@/components/MapView";
import { ReadingControls } from "@/components/ReadingControls";
import { Sidebar } from "@/components/Sidebar";
import { HeatmapNote, SurfaceControls } from "@/components/SurfaceControls";
import { attachLandCover, type LandCoverLayerHandle, type LandCoverStatus } from "@/lib/map/landcover-layer";
import { defaultKind, kindLabel, sortKinds } from "@/lib/map/raster";
import { attachRaster, type RasterLayerHandle, type RasterStatus } from "@/lib/map/raster-layer";
import { statusText, stationsStatusText } from "@/lib/map/status";
import { LATEST, type ReadingMode } from "@/lib/map/stations";
import { attachStations, type StationsLayerHandle, type StationsStatus } from "@/lib/map/stations-layer";
import type { SurfaceMethod } from "@/lib/map/surface";
import { attachSurface, type SurfaceLayerHandle, type SurfaceStatus } from "@/lib/map/surface-layer";
import { niceDomain } from "@/lib/map/temperature";
import { useLegend } from "@/lib/useLegend";
import { useRegions } from "@/lib/useRegions";
import { useStationsRange } from "@/lib/useStationsRange";
import styles from "./page.module.css";

type LayerId = "stations" | "heatmap" | "surface" | "landcover" | "raster";

const DEFAULT_VISIBLE: Record<LayerId, boolean> = { stations: true, heatmap: false, surface: true, landcover: false, raster: false };
const DEFAULT_OPACITY: Record<LayerId, number> = { stations: 1, heatmap: 0.85, surface: 0.75, landcover: 0.6, raster: 0.75 };

const LAND_COVER_LOADING: LandCoverStatus = { state: "loading", count: 0, truncated: false };
const RASTER_LOADING: RasterStatus = { state: "loading" };
const SURFACE_LOADING: SurfaceStatus = { state: "loading" };
const STATIONS_LOADING: StationsStatus = { state: "loading", count: 0, withReading: 0, domain: niceDomain([]) };

export default function Home() {
  const regions = useRegions();
  const [regionId, setRegionId] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [visible, setVisible] = useState(DEFAULT_VISIBLE);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  const [mode, setMode] = useState<ReadingMode>(LATEST);
  const [method, setMethod] = useState<SurfaceMethod>("auto");
  const [rasterKind, setRasterKind] = useState<string | undefined>(undefined);
  const [landStatus, setLandStatus] = useState<LandCoverStatus>(LAND_COVER_LOADING);
  const [stationStatus, setStationStatus] = useState<StationsStatus>(STATIONS_LOADING);
  const [surfaceStatus, setSurfaceStatus] = useState<SurfaceStatus>(SURFACE_LOADING);
  const [rasterStatus, setRasterStatus] = useState<RasterStatus>(RASTER_LOADING);
  const landRef = useRef<LandCoverLayerHandle | null>(null);
  const stationsRef = useRef<StationsLayerHandle | null>(null);
  const surfaceRef = useRef<SurfaceLayerHandle | null>(null);
  const rasterRef = useRef<RasterLayerHandle | null>(null);
  // Latest control values, read when a layer is (re)created, so slider ticks don't re-create layers.
  const live = useRef({ visible, opacity, mode, method });
  live.current = { visible, opacity, mode, method };

  const list = regions.status === "ready" ? regions.regions : [];
  const region = list.find((r) => r.id === regionId) ?? list[0];
  const regionKey = region?.id;
  const regionBounds = region?.bbox;
  const rangeState = useStationsRange(regionKey);
  const days = rangeState.status === "ready" ? rangeState.range.days : undefined;
  const kinds = sortKinds(region?.kinds ?? []);
  const activeKind = rasterKind && kinds.includes(rasterKind) ? rasterKind : defaultKind(kinds);
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;
  const rasterLegend = useLegend(regionKey, activeKind, visible.raster);

  const handleReady = useCallback((m: MapLibreMap) => {
    setMap(m);
    return () => setMap(null);
  }, []);

  // A different region has different days/readings/rasters: start over.
  useEffect(() => {
    setMode(LATEST);
    setRasterKind(undefined);
  }, [regionKey]);

  const hasKinds = kinds.length > 0;
  useEffect(() => {
    if (!map || !regionKey || !regionBounds || !activeKindRef.current) return;
    setRasterStatus(RASTER_LOADING);
    const layer = attachRaster(map, { region: regionKey, kind: activeKindRef.current, bounds: regionBounds, visible: live.current.visible.raster, opacity: live.current.opacity.raster, onStatus: setRasterStatus });
    rasterRef.current = layer;
    return () => {
      layer.destroy();
      rasterRef.current = null;
    };
    // Re-created only for a new map/region; kind changes swap tiles in place.
  }, [map, regionKey, regionBounds, hasKinds]);

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
    setSurfaceStatus(SURFACE_LOADING);
    const layer = attachSurface(map, { region: regionKey, mode: live.current.mode, method: live.current.method, visible: live.current.visible.surface, opacity: live.current.opacity.surface, onStatus: setSurfaceStatus });
    surfaceRef.current = layer;
    return () => {
      layer.destroy();
      surfaceRef.current = null;
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
      heatmapVisible: live.current.visible.heatmap,
      heatmapOpacity: live.current.opacity.heatmap,
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
  useEffect(() => rasterRef.current?.setVisible(visible.raster), [visible.raster]);
  useEffect(() => rasterRef.current?.setOpacity(opacity.raster), [opacity.raster]);
  useEffect(() => (activeKind ? rasterRef.current?.setKind(activeKind) : undefined), [activeKind]);
  useEffect(() => surfaceRef.current?.setVisible(visible.surface), [visible.surface]);
  useEffect(() => surfaceRef.current?.setOpacity(opacity.surface), [opacity.surface]);
  useEffect(() => surfaceRef.current?.setMethod(method), [method]);
  useEffect(() => stationsRef.current?.setVisible(visible.stations), [visible.stations]);
  useEffect(() => stationsRef.current?.setOpacity(opacity.stations), [opacity.stations]);
  useEffect(() => stationsRef.current?.setHeatmapVisible(visible.heatmap), [visible.heatmap]);
  useEffect(() => stationsRef.current?.setHeatmapOpacity(opacity.heatmap), [opacity.heatmap]);
  // The reading drives the stations, the heat map and the surface together.
  useEffect(() => {
    stationsRef.current?.setMode(mode);
    surfaceRef.current?.setMode(mode);
  }, [mode]);

  // One colour scale for everything temperature-coloured: when the surface is showing, stations use its domain.
  const surfaceDomain = visible.surface && surfaceStatus.state === "ready" ? surfaceStatus.meta.domain : null;
  useEffect(() => stationsRef.current?.setDomain(surfaceDomain), [surfaceDomain?.[0], surfaceDomain?.[1]]);
  const temperatureDomain = surfaceDomain ?? stationStatus.domain;

  const surfaceText = !visible.surface
    ? "Hidden"
    : surfaceStatus.state === "loading"
      ? "Loading…"
      : surfaceStatus.state === "error"
        ? surfaceStatus.message
        : "Interpolated from stations";
  const items: LayerItem[] = [
    { id: "stations", label: "Weather stations", visible: visible.stations, opacity: opacity.stations, statusText: stationsStatusText(stationStatus, visible.stations), error: stationStatus.state === "error" },
    { id: "heatmap", label: "Station heat map", visible: visible.heatmap, opacity: opacity.heatmap, statusText: visible.heatmap ? "Kernel density of stations" : "Hidden", controls: <HeatmapNote /> },
    {
      id: "surface",
      label: "Temperature surface",
      visible: visible.surface,
      opacity: opacity.surface,
      statusText: surfaceText,
      error: surfaceStatus.state === "error",
      controls: <SurfaceControls method={method} onMethodChange={setMethod} status={surfaceStatus} />,
    },
    { id: "landcover", label: "Land cover", visible: visible.landcover, opacity: opacity.landcover, statusText: statusText(landStatus, visible.landcover), error: landStatus.state === "error" },
    ...(hasKinds
      ? [
          {
            id: "raster",
            label: "Raster overlay",
            visible: visible.raster,
            opacity: opacity.raster,
            statusText: !visible.raster ? "Hidden" : rasterStatus.state === "error" ? `Some tiles failed to load (${rasterStatus.message})` : rasterStatus.state === "loading" ? "Loading tiles…" : activeKind ? kindLabel(activeKind) : "",
            error: rasterStatus.state === "error",
            controls: (
              <label className={styles.pickerField}>
                <span>Layer</span>
                <select className={styles.picker} aria-label="Raster layer" value={activeKind ?? ""} onChange={(e) => setRasterKind(e.target.value)}>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
            ),
          } satisfies LayerItem,
        ]
      : []),
  ];

  const showTemperature = visible.stations || visible.heatmap || visible.surface;
  const legends = [
    ...(showTemperature ? [{ title: "Temperature", body: <TemperatureLegend domain={temperatureDomain} hasMissing={visible.stations && stationStatus.state === "ready" && stationStatus.withReading < stationStatus.count} /> }] : []),
    ...(visible.landcover ? [{ title: "Land cover", body: <LandCoverLegend /> }] : []),
    ...(visible.raster && activeKind ? [{ title: kindLabel(activeKind), body: <RasterLegend state={rasterLegend} /> }] : []),
  ];

  const retry = (id: string) => {
    const handles: Record<string, { refresh(): void } | null> = { stations: stationsRef.current, surface: surfaceRef.current, landcover: landRef.current, raster: rasterRef.current };
    handles[id]?.refresh();
  };

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
            reading={<ReadingControls mode={mode} onChange={setMode} days={days} />}
            layers={<LayerToggleList items={items} onVisibleChange={(id, v) => setVisible((s) => ({ ...s, [id as LayerId]: v }))} onOpacityChange={(id, o) => setOpacity((s) => ({ ...s, [id as LayerId]: o }))} onRetry={retry} />}
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
