# db/ingest

Python tooling that produces and loads data. Session 3 covers the synthetic
demo city; Session 4 adds real-data adapters (NLCD / Landsat / station CSV).

## One-time setup

```bash
cd db/ingest
python3 -m venv .venv            # on Debian/Ubuntu without python3-venv: pip install --user virtualenv && python3 -m virtualenv .venv
.venv/bin/pip install -r requirements.txt
```

## Demo city (`demo-city`)

A ~250 km² area (EPSG:4326, bbox −122.55..−122.35, 47.55..47.70; 240×180 px,
~57×93 m) with a river, a lake, a dense core, two secondary centres and parks.

```bash
.venv/bin/python -m demo_city.generate   # writes ../../data/rasters/*.tif and ../../data/demo-city/*
.venv/bin/python -m demo_city.load       # loads into PostGIS (needs ./db/migrate.sh applied)
.venv/bin/python -m unittest discover -s tests
```

`generate` is deterministic for a given `--seed` (default 42). `load` replaces
the region's rows in one transaction, so it is safe to re-run.

| Output | Contents |
|---|---|
| `data/rasters/demo-city-{canopy,impervious,lst,elevation}.tif` | float32 GeoTIFFs, deflate, 128px tiles, nodata −9999 |
| `data/demo-city/landcover.geojson` | ~90 MultiPolygons: class + zonal-mean canopy/impervious |
| `data/demo-city/stations.json` | 24 land stations with 24 hourly readings each (2025-07-15, UTC) |
| `data/demo-city/manifest.json` | bbox + raster catalog rows for `raster_layers` |

### How the data is made

Impervious cover and canopy come from a blended urban-intensity field plus
parks and spatially correlated noise. **LST is derived from those drivers**
(`+0.085·impervious − 0.060·canopy − 0.0065·elevation`, a cooling halo near
water, smooth noise), and station air temperatures blend a diurnal cycle with
the local LST. The coefficients are invented, not calibrated to a real city, so
any model trained on this data is a demo — it proves the pipeline, not
climate science. Land cover classes come from threshold rules on the rasters;
polygons are sieved (min 25 px), so tiny land specks inside water get merged
and water polygons read ~0–1% cover rather than exactly 0.
