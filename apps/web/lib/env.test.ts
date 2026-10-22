import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getEnv } from "./env";

test("getEnv validates and resolves paths", () => {
  const env = getEnv({ APP_DATABASE_URL: "postgresql://u:p@localhost:5432/db", RASTER_DIR: "./data/rasters" });
  assert.equal(env.databaseUrl, "postgresql://u:p@localhost:5432/db");
  assert.ok(path.isAbsolute(env.rasterDir) && env.rasterDir.endsWith(path.join("data", "rasters")));
  assert.equal(getEnv({ APP_DATABASE_URL: "postgres://x", RASTER_DIR: "/abs/rasters" }).rasterDir, "/abs/rasters");
});

test("getEnv reports problems clearly", () => {
  assert.throws(() => getEnv({}), /APP_DATABASE_URL is required/);
  assert.throws(() => getEnv({ APP_DATABASE_URL: "mysql://nope" }), /postgres:\/\//);
});
