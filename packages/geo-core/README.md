# @urbanheat/geo-core

Framework-free spatial logic shared by the API routes. ESM, TypeScript, tested
with `node:test`. Raster layer (Session 5) is below; vector/zonal ops (Session 6),
interpolation, features, and ONNX inference arrive in later sessions.

```bash
npm run typecheck -w @urbanheat/geo-core
npm test -w @urbanheat/geo-core     # 30 tests; 2 integration tests skip if data/ isn't generated
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
