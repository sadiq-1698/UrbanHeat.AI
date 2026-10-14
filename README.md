# UrbanHeat.AI — Climate Risk & Surface Temperature Predictor

Predicts microclimate temperature spikes from canopy loss and impervious-surface
coverage. Raster analysis (geotiff.js), vector ops (turf.js), PostGIS land cover and
weather stations, and an XGBoost/Random Forest model served in Node via ONNX Runtime,
visualized as heatmaps and interpolated surfaces in MapLibre GL JS.

## Architecture

- **`apps/web`** — Next.js (App Router) UI + MapLibre map; route handlers are the Node backend.
- **`packages/geo-core`** — shared spatial logic: GeoTIFF reads, zonal stats, interpolation, feature building, ONNX inference.
- **`db`** — PostGIS schema (land cover polygons, weather stations, raster catalog) and ingestion.
- **`ml`** — Python dataset building, model training, ONNX export.

## Setup

```bash
cp .env.example .env     # set passwords; uncomment POSTGRES_HOST_PORT if 5432 is taken
npm install
docker compose up -d
./db/migrate.sh          # applies db/schema (safe to re-run)
docker compose exec postgis pg_isready -U urbanheat_admin -d urbanheat
npm run typecheck && npm test
```

Requires Node >= 20, Docker, and Python 3 (for `ml/` and `db/ingest`).

## Roadmap

- [x] Session 1 — Scaffold: workspaces, tsconfig, env, PostGIS compose, geo-core skeleton
- [x] Session 2 — DB schema: land_cover, weather_stations + observations, raster_layers, read-only role, `db/migrate.sh` (see [db/README.md](db/README.md))
- [ ] 3 Demo data · 4 Real-data adapters
- [ ] 5–6 Raster & vector core · 7 Data API
- [ ] 8–12 Map UI, raster overlay, interpolation, heatmap
- [ ] 13–16 Features, training, ONNX inference, predict API
- [ ] 17–18 Scenario simulator, risk & hotspots
- [ ] 19–20 Hardening, verification, write-up
