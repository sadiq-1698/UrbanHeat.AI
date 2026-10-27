import { LAND_COVER_ORDER, LAND_COVER_STYLES } from "@/lib/map/landcover";
import { formatDomainValue, kindLabel, legendGradient } from "@/lib/map/raster";
import { type Domain, NO_DATA_COLOR, gradientCss } from "@/lib/map/temperature";
import type { LegendState } from "@/lib/useLegend";
import styles from "./Legend.module.css";

export function TemperatureLegend({ domain, hasMissing }: { domain: Domain; hasMissing: boolean }) {
  return (
    <div>
      <div className={styles.bar} style={{ background: gradientCss() }} role="img" aria-label={`Temperature scale from ${domain[0]} to ${domain[1]} degrees Celsius`} />
      <div className={styles.ends}>
        <span>{domain[0]} °C</span>
        <span>{domain[1]} °C</span>
      </div>
      <p className={styles.note}>Scale adapts to the readings currently shown.</p>
      {hasMissing && (
        <div className={styles.nodata}>
          <span className={styles.swatch} style={{ background: NO_DATA_COLOR }} /> No reading
        </div>
      )}
    </div>
  );
}

export function LandCoverLegend() {
  return (
    <ul className={styles.legend}>
      {LAND_COVER_ORDER.map((c) => (
        <li key={c}>
          <span className={styles.swatch} style={{ background: LAND_COVER_STYLES[c].color }} />
          {LAND_COVER_STYLES[c].label}
        </li>
      ))}
    </ul>
  );
}

export function RasterLegend({ state }: { state: LegendState }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <p className={styles.note}>Loading legend…</p>;
  if (state.status === "error") return <p className={styles.note}>Legend unavailable.</p>;
  const { legend } = state;
  return (
    <div>
      <div className={styles.alphaBar} role="img" aria-label={`${kindLabel(legend.kind)} scale from ${formatDomainValue(legend.domain[0], legend.unit)} to ${formatDomainValue(legend.domain[1], legend.unit)}`}>
        <div style={{ background: legendGradient(legend.stops, legend.domain) }} />
      </div>
      <div className={styles.ends}>
        <span>{formatDomainValue(legend.domain[0], legend.unit)}</span>
        <span>{formatDomainValue(legend.domain[1], legend.unit)}</span>
      </div>
    </div>
  );
}
