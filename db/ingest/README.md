# db/ingest

Python tooling that produces and loads data: the synthetic demo city (Session 3)
and adapters for real data (Session 4). Both write the same `data/<region>/`
layout, and `demo_city.load` loads either.

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
.venv/bin/python -W ignore::PendingDeprecationWarning -m unittest discover -s tests -t .   # all tests
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

## Real data (`real_data.ingest`)

Clips and reprojects downloaded files onto a regular EPSG:4326 grid for a bbox,
then writes the same GeoTIFFs / `landcover.geojson` / `stations.json` /
`manifest.json` as the demo generator.

| Input | Source (download yourself) | Handling |
|---|---|---|
| `--nlcd-landcover` | NLCD Land Cover (MRLC) | codes → `land_cover.class`, nearest-neighbour, polygonized + sieved |
| `--nlcd-canopy` | NLCD Tree Canopy Cover (MRLC) | 0–100 %, fill codes (>100) masked |
| `--nlcd-impervious` | NLCD Impervious Surface (MRLC) | 0–100 %, fill codes (>100) masked |
| `--lst` | Landsat Collection 2 Level-2 `ST_B10` (USGS) | DN → °C (`--lst-units landsat-c2`, or `celsius` / `kelvin` if pre-converted) |
| `--dem` *(optional)* | any elevation GeoTIFF in meters | resampled to the grid |
| `--stations-csv` *(optional)* | NOAA ISD / GHCNh export or your own | long format: `station_id,name,lat,lon,elevation_m,timestamp,temp,humidity_pct,wind` |

```bash
.venv/bin/python -m real_data.ingest --region bellingham-wa \
    --bbox -122.56 48.69 -122.40 48.80 --res 0.0003 \
    --nlcd-landcover NLCD_2021_Land_Cover.tif --nlcd-canopy nlcd_tcc_2021.tif \
    --nlcd-impervious NLCD_2021_Impervious.tif --lst LC09_..._ST_B10.tif \
    --stations-csv obs.csv --temp-unit f --wind-unit mph --station-source noaa-isd
.venv/bin/python -m demo_city.load --region bellingham-wa
```

Inputs may be in any CRS (NLCD ships in EPSG:5070); only a bbox-sized window is
read, so CONUS-wide files are fine. `--res` is in degrees (default 0.0003 ≈ 33 m).
Column names in the CSV can be remapped in code via `read_stations_csv(columns=...)`;
naive timestamps are treated as UTC. Rows that are incomplete, outside the bbox, or
physically implausible (outside −60..60 °C) are skipped and counted in the summary
the command prints. The command aborts if more than 5 % of land cover cells fall
outside the NLCD legend (usually a bbox outside the raster's coverage).

**Verification status:** the adapters are tested against *synthetic* NLCD/Landsat-shaped
rasters in EPSG:5070 (reprojection, fill-code masking, DN→°C, class mapping, the full
CLI → PostGIS path). They have **not** yet been run on genuine downloaded NLCD/Landsat
files or a real NOAA export — that happens in Session 20.
