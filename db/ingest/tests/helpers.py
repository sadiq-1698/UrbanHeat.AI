"""Builds NLCD/Landsat-shaped GeoTIFFs in a projected CRS for adapter tests."""
import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.warp import transform_bounds

SRC_CRS = "EPSG:5070"  # CONUS Albers — what NLCD ships in


def write_projected(path, array, grid, *, pixel=30.0, margin=600.0, nodata=None, dtype="uint8"):
    """Write `array`-generating callable output covering `grid` plus a margin.

    `array` is called as array(rows, cols, x_centres, y_centres) in the source CRS.
    """
    l, b, r, t = transform_bounds("EPSG:4326", SRC_CRS, grid.west, grid.south,
                                  grid.east, grid.north, densify_pts=21)
    l, t = l - margin, t + margin
    cols = int((r + margin - l) / pixel) + 1
    rows = int((t - (b - margin)) / pixel) + 1
    xs = l + (np.arange(cols) + 0.5) * pixel
    ys = t - (np.arange(rows) + 0.5) * pixel
    data = array(rows, cols, *np.meshgrid(xs, ys)).astype(dtype)
    with rasterio.open(path, "w", driver="GTiff", height=rows, width=cols, count=1, dtype=dtype,
                       crs=SRC_CRS, transform=Affine(pixel, 0.0, l, 0.0, -pixel, t), nodata=nodata) as dst:
        dst.write(data, 1)
    return path
