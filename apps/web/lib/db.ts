import { Pool } from "pg";
import { getEnv } from "./env";

// One pool per server process. Next's dev server re-evaluates modules on edits, so the
// pool is parked on globalThis to avoid leaking a new set of connections each reload.
const globalForPg = globalThis as unknown as { __urbanheatPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__urbanheatPool) {
    const pool = new Pool({ connectionString: getEnv().databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
    // An idle client erroring (e.g. DB restart) must not crash the process.
    pool.on("error", (err) => console.error("pg pool error:", err.message));
    globalForPg.__urbanheatPool = pool;
  }
  return globalForPg.__urbanheatPool;
}
