import { config } from "dotenv";
import path from "node:path";
import type { NextConfig } from "next";

// Next.js only loads .env* files from this package's own root, but the repo keeps a
// single .env at the monorepo root (docker-compose and db/migrate.sh read it too).
// Load it into process.env first; process.env wins in Next's own lookup order.
// A missing file is fine (CI / typecheck).
config({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });

const nextConfig: NextConfig = {
  // geotiff reads files through Node's fs; keep it out of the bundle and load it natively.
  serverExternalPackages: ["geotiff"],
};

export default nextConfig;
