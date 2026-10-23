"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 has no default export: every class is a plain named export, including a
// MapLibreMap alias for Map (avoiding a clash with the built-in JS Map).
import { MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { BASEMAP_STYLE_URL, FALLBACK_STYLE } from "@/lib/map/config";
import type { BBox } from "@/lib/map/geo";
import styles from "./MapView.module.css";

// maplibre-gl loads its tile-parsing worker via a bundler-rewritten `new URL(..., import.meta.url)`
// that Turbopack doesn't rewrite for node_modules, so it would 404 and log "Worker failed to load".
// scripts/copy-maplibre-worker.mjs copies the worker into public/; point at that static copy.
// Must run before any Map is constructed.
setWorkerUrl("/maplibre-gl/maplibre-gl-worker.mjs");

export interface MapViewProps {
  /** Fit the camera here once the map has loaded and whenever it changes (e.g. a new region). */
  bounds?: BBox | null;
  /** Called with the live map once its style has loaded; the returned cleanup runs on teardown. */
  onReady?: (map: MapLibreMap) => void | (() => void);
  className?: string;
}

export function MapView({ bounds, onReady, className }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new MapLibreMap({ container, style: BASEMAP_STYLE_URL, center: [0, 20], zoom: 1.5 });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

    let cleanup: void | (() => void);
    let ready = false;
    const markReady = () => {
      if (ready) return;
      ready = true;
      setLoaded(true);
      cleanup = onReadyRef.current?.(map);
    };
    map.once("load", markReady);

    // A failure before the first load is almost always the basemap style (offline / blocked).
    // Swap to a blank style so the analysis layers are still usable instead of a dead pane.
    const onError = () => {
      if (ready) return; // tile/sprite hiccups after load are non-fatal
      setOffline(true);
      map.off("error", onError);
      map.setStyle(FALLBACK_STYLE);
      map.once("idle", markReady);
    };
    map.on("error", onError);

    // MapLibre sizes its canvas once at construction; in a CSS grid the container may not have its
    // final size yet, leaving the canvas smaller than its pane until the window is resized.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (typeof cleanup === "function") cleanup();
      map.remove();
      mapRef.current = null;
      setLoaded(false);
      setOffline(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !bounds) return;
    map.fitBounds(bounds, { padding: 32, duration: 0 });
  }, [bounds, loaded]);

  return (
    <div className={`${styles.wrapper} ${className ?? ""}`}>
      <div ref={containerRef} className={styles.map} />
      {!loaded && <div className={styles.overlay}>Loading map…</div>}
      {offline && <div className={styles.notice}>Basemap unavailable (offline?) — showing data on a plain background.</div>}
    </div>
  );
}
