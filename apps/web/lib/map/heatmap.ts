import { type Domain, RAMP } from "./temperature";

/** Weight of the coolest reading: above 0 so cool stations still contribute (and show as the cool end of the ramp). */
export const MIN_WEIGHT = 0.15;

/** Per-station kernel weight, rising linearly from MIN_WEIGHT (domain min) to 1 (domain max); no reading = 0. */
export function weightExpression(domain: Domain, property = "temp_c"): unknown[] {
  return [
    "case",
    ["==", ["typeof", ["get", property]], "number"],
    ["interpolate", ["linear"], ["get", property], domain[0], MIN_WEIGHT, domain[1], 1],
    0,
  ];
}

const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${a})`;

/**
 * Colour by accumulated kernel density (0..1): transparent at zero, then the temperature ramp. Colour reflects
 * density x temperature weight, so it is a visual summary of where the hot stations are, not an estimated temperature.
 */
export function colorExpression(): unknown[] {
  // The cool end is mostly transparent: low density means "few stations nearby", not "cool", so it should fade out.
  const alphas = [0.12, 0.45, 0.72, 0.86, 0.95];
  const stops = RAMP.flatMap((c, i) => [0.15 + (0.85 * i) / (RAMP.length - 1), rgba(c, alphas[i]!)]);
  return ["interpolate", ["linear"], ["heatmap-density"], 0, rgba(RAMP[0], 0), ...stops];
}

/**
 * Kernel radius in screen pixels. Stations are a few km apart, so neighbouring kernels must overlap to form a field
 * rather than isolated glows; the on-screen spacing doubles with each zoom level, so the radius roughly does too
 * (capped, because very large kernels are slow to draw).
 */
export const RADIUS_EXPRESSION: unknown[] = ["interpolate", ["linear"], ["zoom"], 8, 14, 10, 60, 12, 160, 14, 250];

/** Higher intensity than the default so that warm stations reach the warm end of the ramp. */
export const INTENSITY_EXPRESSION: unknown[] = ["interpolate", ["linear"], ["zoom"], 8, 1.2, 12, 2, 14, 2.5];
