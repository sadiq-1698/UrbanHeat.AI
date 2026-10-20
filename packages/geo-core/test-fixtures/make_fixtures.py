"""Regenerates the tiny GeoTIFF fixtures used by geo-core's tests.

Run with the ingest venv:  db/ingest/.venv/bin/python packages/geo-core/test-fixtures/make_fixtures.py
Fixtures are written by GDAL (via rasterio), so they exercise real-world encodings.
"""
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine

OUT = Path(__file__).parent


def write(name, data, west, north, res, *, crs="EPSG:4326", nodata=None, **opts):
    h, w = data.shape
    with rasterio.open(OUT / name, "w", driver="GTiff", height=h, width=w, count=1,
                       dtype=data.dtype, crs=crs, nodata=nodata,
                       transform=Affine(res, 0, west, 0, -res, north), **opts) as dst:
        dst.write(data, 1)


# 4x4, lon 10..14, lat 50..54, value = row*4+col+1 (row 0 = north), nodata -9999 declared.
grid = np.arange(1, 17, dtype="float32").reshape(4, 4)
write("grid4.tif", grid, 10, 54, 1.0, nodata=-9999.0)

holes = grid.copy()
holes[1, 1] = -9999.0  # value 6 at lon 11..12, lat 52..53
write("grid4-nodata.tif", holes, 10, 54, 1.0, nodata=-9999.0)

write("grid4-nad83.tif", grid, 10, 54, 1.0, crs="EPSG:4269")
write("grid4-uint8.tif", np.arange(1, 17, dtype="uint8").reshape(4, 4), 10, 54, 1.0, nodata=0)

# 300x200 deflate-compressed, tiled 128px: value = row*1000 + col (exact in float32).
rows, cols = np.mgrid[0:200, 0:300]
write("ramp-tiled.tif", (rows * 1000 + cols).astype("float32"), -122.55, 47.70, 0.001,
      nodata=-9999.0, compress="deflate", tiled=True, blockxsize=128, blockysize=128)
