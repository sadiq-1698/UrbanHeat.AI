import { config } from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

// Next.js only loads .env* files from this package's own root, but the repo keeps a
// single .env at the monorepo root (docker-compose and db/migrate.sh read it too).
// Load it into process.env first; process.env wins in Next's own lookup order.
// A missing file is fine (CI / typecheck).
const repoRoot = path.resolve(__dirname, "..", "..");
config({ path: path.join(repoRoot, ".env"), quiet: true });

// Resolve RASTER_DIR to an absolute path here, where the repo root is known. Doing
// `path.resolve(process.cwd(), ...)` inside server code makes Turbopack trace the whole
// project into the server bundle (build warning); lib/env.ts therefore requires an absolute path.
process.env.RASTER_DIR = path.resolve(repoRoot, process.env.RASTER_DIR ?? "./data/rasters");

const nextConfig: NextConfig = {
  // geotiff reads files through Node's fs; keep it out of the bundle and load it natively.
  serverExternalPackages: ["geotiff"],
};

export default nextConfig;
