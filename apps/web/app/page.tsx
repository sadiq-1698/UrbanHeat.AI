"use client";

import { MapView } from "@/components/MapView";
import { useRegions } from "@/lib/useRegions";
import styles from "./page.module.css";

export default function Home() {
  const regions = useRegions();
  const region = regions.status === "ready" ? regions.regions[0] : undefined;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>UrbanHeat.AI</h1>
        <span className={styles.subtitle}>Climate risk &amp; surface temperature{region ? ` · ${region.id}` : ""}</span>
      </header>
      <main className={styles.main}>
        {regions.status === "error" ? (
          <div className={styles.message}>Couldn&apos;t load the region list ({regions.message}). Is the database running and migrated?</div>
        ) : regions.status === "ready" && !region ? (
          <div className={styles.message}>No regions loaded yet. Run the demo-city generator and loader (see db/ingest/README.md).</div>
        ) : (
          <MapView bounds={region?.bbox} />
        )}
      </main>
    </div>
  );
}
