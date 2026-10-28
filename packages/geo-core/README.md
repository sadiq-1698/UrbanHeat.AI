# @urbanheat/geo-core

Framework-free spatial logic shared by the API routes. ESM, TypeScript, tested
with `node:test`. Raster (Session 5), vector/zonal (Session 6) and tile rendering (Session 10) and interpolation (Session 11) are
below; features, and ONNX inference arrive in later sessions.

```bash
npm run typecheck -w @urbanheat/geo-core
npm test -w @urbanheat/geo-core     # 103 tests; 3 integration tests skip if data/ isn't generated
```

## Raster API

| Export | Purpose |
|---|---|
| `GeoTiffRaster` | Lazy geotiff.js reader. `open(path)` / `fromBuffer()`, `read(bbox?)`, `readResampled(bbox, w, h, method)`, `sample(lon, lat, {method})`, `sampleMany(points)`. Decodes only the requested window; no-data → `NaN`. |
| `RasterGrid` | In-memory float32 grid + bbox: `valueAt`, `bilinearAt`, `stats()`, `at(row, col)`. |
| `cropGrid`, `windowForBBox` | Snap a bbox outward to whole cells and slice. |
| `resampleGrid` | `nearest` (categorical), `bilinear` (smooth enlargement), `average` (shrinking; area-weighted). All ignore NaN and renormalize. |
| `RasterStore` | Handle cache rooted at `RASTER_DIR`; rejects `..`/absolute escapes and non-`.tif` paths; failed opens are not cached. |

```ts
const store = new RasterStore(process.env.RASTER_DIR!);
const lst = await store.get("demo-city-lst.tif");
await lst.sample(-122.45, 47.62);                       // °C at a point (null if outside/no-data)
const tile = await lst.readResampled([-122.5, 47.6, -122.4, 47.7], 256, 256, "average");
tile?.stats();                                          // { count, nodata, min, max, mean, std }
```

### Behaviour worth knowing

- **EPSG:4326, north-up only.** Other CRSs are rejected with a `gdalwarp -t_srs EPSG:4326` hint
  (`db/ingest` already emits 4326 grids).
- **Windows snap outward** to whole cells, so a returned grid can be slightly larger than the
  requested bbox; its `bbox` is always the true extent.
- **Cell edges:** a point exactly on a boundary belongs to the cell to its east/south, decided by
  floating-point arithmetic. GDAL's `gdallocationinfo` can break such ties the other way. Away from
  edges the two agree to ~1e-13 (checked on 400 random points across the four demo rasters).
- **`maxPixels`** (default 16M cells) guards against reading a huge window into memory; geotiff.js
  overviews are not used, so downsampling reads native resolution first.
- Fixtures in `test-fixtures/` are tiny GDAL-written GeoTIFFs (regenerate with `make_fixtures.py`).
  geotiff.js's own writer only emits 8-bit data, so it can't build float32 test files.

## Vector & zonal API

| Export | Purpose |
|---|---|
| `zonalStats(grid, polygon)` | Coverage-weighted `mean/min/max/std`, effective cell `weight`, `nodataShare`, polygon `areaM2`. Null if the polygon misses the grid. |
| `zonalShare(grid, polygon, pred)` | Weighted share of valid cells satisfying `pred` (e.g. `v => v > 50`). |
| `zonalStatsLayers(layers, polygon)` / `zonalStatsMany` | The same for several aligned rasters at once, building the coverage mask once; `assertSameGrid` enforces cell-for-cell alignment. |
| `bufferStats(layers, lon, lat, radiusM)` | Stats of every layer within a metre radius of a point (turf buffer circle). |
| `coverageMask` / `statsFromMask` | The building blocks: per-cell coverage fractions (0..1) and stats under a mask. |
| `summarizeLandCover(polygon, features)` | Area-weighted canopy/impervious % and class shares from land cover polygons, via `turf.intersect` and geodesic area. Counts (`skipped`) geometries turf can't process instead of failing. |
| `circlePolygon`, `pointInPolygons`, `boundsOf`, `haversineM`, `cellAreaM2`, `metersPerDegree` | Geometry helpers. |

```ts
const layers = { lst, canopy, impervious };          // three RasterGrids on the same grid
const r = bufferStats(layers, -122.45, 47.625, 800);
r?.stats.lst.mean;  r?.stats.canopy.mean;           // heat vs. green cover within 800 m

const lc = summarizeLandCover(r!.buffer, rowsFromPostgis);   // rows: {geometry, properties}
lc?.classShares;                                    // { developed_high: 0.62, forest: 0.21, ... }
```

### How polygon coverage works

Each cell's coverage is estimated by sampling an n×n grid of points inside it (`supersample`,
default 4; 1 = cell-centre test, which matches rasterio's default masking). Coverage is computed
with a scanline fill: edge crossings are found once per sub-row and spans are filled, with
even-odd handling of holes and multipolygons. This replaced a per-point containment test that took
10.4 s for the 92 demo land cover polygons; the scanline version takes ~17 ms and is checked
against brute-force point-in-polygon in the tests. Polygons smaller than the sampling resolution
fall back to the single cell at their centre, so tiny buffers still return a value.

### Cross-checks run against real data (not part of the test suite)

- Zonal means of the demo canopy/impervious rasters over all 92 land cover polygons match the
  `canopy_pct` / `impervious_pct` values Python stored in PostGIS to within 0.005 (their 2-dp rounding).
- `summarizeLandCover` over four circles (0.8–5 km) matches a PostGIS `ST_Intersection` area-weighted
  query to 3 decimals on both percentages. Total covered area differs by a constant 0.28 % because
  turf measures on a sphere and PostGIS on the WGS84 spheroid.

### Limits

- Polygons are treated as planar in lon/lat when sampling cells (fine at city scale); areas
  (`areaM2`, land cover weights) are geodesic.
- Polygons crossing the antimeridian are not supported.
- `summarizeLandCover` does a bbox pre-filter then pairwise intersections: fine for hundreds of
  polygons, but filter with PostGIS (`ST_Intersects`) first for large tables.

## Tile rendering (Session 10)

| Export | Purpose |
|---|---|
| `tileBBox`, `lonLatToTile`, `pixelLon`, `pixelLat`, `isValidTile` | Web Mercator XYZ tile math. Pixel rows are evenly spaced in Mercator y (not latitude), so latitude is computed per row. |
| `renderTilePng(raster, z, x, y, colormap)` | Reads only the tile's window from a `GeoTiffRaster`, samples each pixel centre (bilinear by default; `nearest` for categorical data), colors it, and returns a PNG `Buffer`, or `null` if the tile misses the raster. |
| `renderTileRgba(grid, z, x, y, colormap)` | The same from an in-memory `RasterGrid`, returning raw RGBA. |
| `encodePng`, `emptyTilePng` | Dependency-free 8-bit RGBA PNG encoder (`node:zlib`, `zlib.crc32`; needs Node >= 20.15). Validated against GDAL's PNG decoder. |
| `colormapFromHex`, `colorAtValue`, `colormapForKind`, `RAMPS`, `FIXED_DOMAINS` | Piecewise-linear ramps with **per-stop alpha**: canopy and impervious fade to transparent at 0 so bare ground shows the basemap. |
| `percentile`, `robustDomain` | Color domain from the 2nd..98th percentile (rounded outward) so a few outlier cells don't flatten a ramp. |

Notes:

- **Zoomed-out tiles are averaged first.** When many raster cells fall inside one output pixel, point sampling
  speckles; the renderer area-averages the window down to about one cell per pixel before sampling (Mercator
  pixels are square on the ground, so their height in degrees is `pixelDeg * cos(lat)`). A test proves this by
  failing with a 234-wide speckle spread when the averaging is disabled.
- **No overviews.** Low-zoom tiles of a very large raster would decode a huge window; `maxPixels` (16 M cells by
  default) turns that into a `RangeError` instead. Rasters beyond that need `gdaladdo` overviews (not implemented).
- Tile pixels were checked against an independent Python implementation (tile math, bilinear sampling, legend
  colors): 400 random pixels, max channel difference 0.

## Interpolation (Session 11)

Continuous surfaces from point readings. Two methods, plus an honest way to compare them.

| Export | Purpose |
|---|---|
| `idwAt`, `idwGrid`, `idwDetail` | Inverse-distance weighting from the `neighbors` nearest points (default 12, power 2). A weighted average, so it never overshoots the data range; exact (the station's own value) within ~1 m of a station. `maxDistanceM` leaves far cells empty. |
| `fitLinear`, `predictLinear` | Ridge-regularized least squares (standardized features, Cholesky solve). Constant features get 0; collinear or under-determined fits stay finite. |
| `regressionIdwGrid`, `prepareRegression`, `regressionPredict(Detail)` | **Regression + residual IDW**: fit value ~ covariates at the stations, interpolate the station residuals with IDW, add them to the covariate trend. Still an exact interpolator at stations, but between them it follows the covariates (here: impervious, canopy, elevation rasters). |
| `leaveOneOut`, `idwLeaveOneOut`, `regressionLeaveOneOut` | Leave-one-out cross-validation: predict each station from all the others (the regression is **re-fitted every fold**). RMSE / MAE / bias of held-out error, the honest accuracy estimate for an unobserved location. |

How the regression variant behaves, and why:

- **Residual influence fades with distance** (`exp(-(d/range)^2)`, range = 2x the mean nearest-station spacing), so far from any station
  the surface relaxes to the covariate trend instead of freezing at the nearest station's residual. (A constant offset across all stations is
  absorbed by the intercept, so residual effects only show where unexplained signal varies in space.)
- **Covariates are clamped to the range the stations saw** (`clamp`, default on). Found the hard way: open water has canopy = 0, impervious = 0, elevation = 0,
  a combination no land station experiences, and the linear model extrapolated to about its intercept: the river rendered *warm*. Clamping bounds that;
  `clampedShare` reports how much of the surface is extrapolated. The cost: where the stations under-sample an extreme (the densest core) the peak is capped.
  Leave-one-out cannot judge this choice (held-out stations lie inside the covariate range), so it is a conservative judgment call, not something the numbers prove.
- Tests plant a known linear truth: the fit recovers coefficients, the surface matches the truth at cell centres, and regression beats IDW by >2x RMSE both at
  held-out stations and across the whole grid. IDW was checked against an independent numpy implementation (3 parameter settings, max difference 0.005 = output rounding).

Limits: IDW costs O(stations x neighbors) per cell (fine to a couple of thousand stations); distances are equirectangular at the target latitude
(city scale); the regression is linear in the covariates (no interactions or nonlinearity; that is what the Session 14 model is for).
