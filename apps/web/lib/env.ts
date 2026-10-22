import path from "node:path";
import { z } from "zod";

const REPO_ROOT = path.resolve(process.cwd(), process.cwd().endsWith(path.join("apps", "web")) ? "../.." : ".");

const schema = z.object({
  APP_DATABASE_URL: z
    .string({ error: "APP_DATABASE_URL is required (read-only connection; see .env.example)" })
    .regex(/^postgres(ql)?:\/\//, "APP_DATABASE_URL must be a postgres:// URL"),
  RASTER_DIR: z.string().default("./data/rasters"),
});

export interface Env {
  databaseUrl: string;
  /** Absolute path; relative values in .env resolve against the repo root. */
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
    rasterDir: path.resolve(REPO_ROOT, parsed.data.RASTER_DIR),
  };
  if (source === process.env) cached = env;
  return env;
}
