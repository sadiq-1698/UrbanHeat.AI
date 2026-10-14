# db

PostGIS schema for UrbanHeat.AI. All geometries are EPSG:4326.

| File | Creates |
|---|---|
| `001_extensions.sql` | `postgis` |
| `002_land_cover.sql` | `land_cover` — MultiPolygons with `class`, `canopy_pct`, `impervious_pct` (0–100), `area_m2` |
| `003_weather_stations.sql` | `weather_stations` (Point) and `station_observations` (temp/humidity/wind per timestamp) |
| `004_raster_layers.sql` | `raster_layers` — catalog of GeoTIFFs on disk (`path` is relative to `RASTER_DIR`); pixel data is never stored in PostGIS |
| `005_roles.sh` | `urbanheat_ro` read-only role (password from `APP_RO_PASSWORD`) used by the API routes |

`region` on each table is a free-text label rather than a foreign key, so a new
city needs no schema change.

## Applying

On a **fresh** Docker volume, everything in `db/schema/` runs automatically in
filename order. For an existing database (or after adding a file):

```bash
./db/migrate.sh
```

`migrate.sh` records applied versions in `schema_migrations`, so it is safe to
re-run. Needs `psql` on the host and `DATABASE_URL` (read from `.env`).

## Read-only role

`urbanheat_ro` has `SELECT` only, `default_transaction_read_only = on`, and a 10s
`statement_timeout`; future tables are auto-readable via default privileges.
