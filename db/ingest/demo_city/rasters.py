"""GeoTIFF output for the demo city."""
from pathlib import Path

import numpy as np
import rasterio

from .grid import Grid

NODATA = -9999.0

# kind -> (field key, unit, description); `kind` matches raster_layers.kind.
LAYERS = {
    "canopy": ("canopy", "percent", "Tree canopy cover (synthetic)"),
    "impervious": ("impervious", "percent", "Impervious surface cover (synthetic)"),
    "lst": ("lst", "celsius", "Land surface temperature, summer afternoon (synthetic)"),
    "elevation": ("elevation", "meters", "Elevation above river level (synthetic)"),
}


def write_geotiff(path: Path, data: np.ndarray, grid: Grid) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path, "w", driver="GTiff", height=grid.height, width=grid.width, count=1,
        dtype="float32", crs="EPSG:4326", transform=grid.transform, nodata=NODATA,
        compress="deflate", tiled=True, blockxsize=128, blockysize=128,
    ) as dst:
        dst.write(data.astype("float32"), 1)
