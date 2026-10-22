import path from "node:path";
import { z } from "zod";

const schema = z.object({
  APP_DATABASE_URL: z
    .string({ error: "APP_DATABASE_URL is required (read-only connection; see .env.example)" })
    .regex(/^postgres(ql)?:\/\//, "APP_DATABASE_URL must be a postgres:// URL"),
  // next.config.ts resolves a relative .env value (default ./data/rasters) against the repo root.
  RASTER_DIR: z.string({ error: "RASTER_DIR is required" }).refine((p) => path.isAbsolute(p), "RASTER_DIR must be an absolute path"),
});

export interface Env {
  databaseUrl: string;
  /** Absolute path to the GeoTIFF directory. */
  rasterDir: string;
}

let cached: Env | undefined;

/** Validated server environment; throws one readable error listing every problem. Memoized. */
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const env: Env = {
    databaseUrl: parsed.data.APP_DATABASE_URL,
    rasterDir: parsed.data.RASTER_DIR,
  };
  if (source === process.env) cached = env;
  return env;
}
