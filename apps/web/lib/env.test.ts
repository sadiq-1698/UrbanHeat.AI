import { test } from "node:test";
import assert from "node:assert/strict";
import { getEnv } from "./env";

test("getEnv validates and returns the settings", () => {
  const env = getEnv({ APP_DATABASE_URL: "postgresql://u:p@localhost:5432/db", RASTER_DIR: "/srv/data/rasters" });
  assert.equal(env.databaseUrl, "postgresql://u:p@localhost:5432/db");
  assert.equal(env.rasterDir, "/srv/data/rasters");
});

test("getEnv reports problems clearly", () => {
  assert.throws(() => getEnv({ RASTER_DIR: "/r" }), /APP_DATABASE_URL is required/);
  assert.throws(() => getEnv({ APP_DATABASE_URL: "mysql://nope", RASTER_DIR: "/r" }), /postgres:\/\//);
  assert.throws(() => getEnv({ APP_DATABASE_URL: "postgres://x", RASTER_DIR: "./relative" }), /absolute path/);
  assert.throws(() => getEnv({ APP_DATABASE_URL: "postgres://x" }), /RASTER_DIR is required/);
});
