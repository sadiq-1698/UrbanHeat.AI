"""Clip/reproject real-world rasters (NLCD, Landsat, DEM) onto the project grid.

Sources are read through a bbox-sized window, so a multi-GB CONUS-wide NLCD
GeoTIFF is never loaded whole. Everything is returned as float32 with NaN for
no-data, aligned to a `Grid` (EPSG:4326).
"""
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from demo_city.grid import Grid
from demo_city.vectors import CLASS_IDS

# NLCD land cover legend -> land_cover.class (see db/schema/002_land_cover.sql).
NLCD_TO_CLASS = {
    11: "water", 12: "barren",
    21: "developed_open", 22: "developed_low", 23: "developed_medium", 24: "developed_high",
    31: "barren", 41: "forest", 42: "forest", 43: "forest",
    51: "shrub_grass", 52: "shrub_grass", 71: "shrub_grass", 72: "shrub_grass",
    73: "shrub_grass", 74: "shrub_grass", 81: "cropland", 82: "cropland",
    90: "wetland", 95: "wetland",
}

# Landsat Collection 2 Level-2 surface temperature (ST_B10): K = DN * 0.00341802 + 149.0
LANDSAT_C2_ST_SCALE = 0.00341802
LANDSAT_C2_ST_OFFSET = 149.0


def _window_for(src: rasterio.DatasetReader, grid: Grid, pad_px: int = 4) -> Window:
    """Source-pixel window covering the grid's extent (plus padding for resampling)."""
    left, bottom, right, top = transform_bounds(
        "EPSG:4326", src.crs, grid.west, grid.south, grid.east, grid.north, densify_pts=21)
    win = from_bounds(left, bottom, right, top, src.transform)
    win = Window(win.col_off - pad_px, win.row_off - pad_px,
                 win.width + 2 * pad_px, win.height + 2 * pad_px)
    full = Window(0, 0, src.width, src.height)
    try:
        return win.intersection(full)
    except rasterio.errors.WindowError:
        raise ValueError(f"{src.name}: raster does not overlap the requested bbox") from None


def clip_to_grid(path: Path, grid: Grid, *, resampling: Resampling = Resampling.bilinear,
                 valid_range: tuple[float, float] | None = None,
                 band: int = 1) -> np.ndarray:
    """Read `path` over the grid extent, reproject to the grid, return float32 + NaN.

    Cells that are the file's nodata, or outside `valid_range` (e.g. NLCD's
    255/127 fill codes), are masked *before* resampling so fill values never
    bleed into averaged neighbours.
    """
    with rasterio.open(path) as src:
        win = _window_for(src, grid)
        data = src.read(band, window=win).astype("float32")
        if src.nodata is not None:
            data[data == np.float32(src.nodata)] = np.nan
        if valid_range is not None:
            lo, hi = valid_range
            data[(data < lo) | (data > hi)] = np.nan
        out = np.full((grid.height, grid.width), np.nan, dtype="float32")
        reproject(
            source=data, destination=out,
            src_transform=src.window_transform(win), src_crs=src.crs, src_nodata=np.nan,
            dst_transform=grid.transform, dst_crs="EPSG:4326", dst_nodata=np.nan,
            resampling=resampling,
        )
    if np.isnan(out).all():
        raise ValueError(f"{path}: no valid data inside the requested bbox")
    return out


def nlcd_class_ids(codes: np.ndarray) -> tuple[np.ndarray, float]:
    """Map NLCD codes to CLASS_IDS (uint8). Unmapped/NaN cells become `barren`;
    returns the array and the fraction of cells that were unmapped."""
    out = np.full(codes.shape, CLASS_IDS["barren"], dtype=np.uint8)
    mapped = np.zeros(codes.shape, dtype=bool)
    for code, cls in NLCD_TO_CLASS.items():
        m = codes == code
        out[m] = CLASS_IDS[cls]
        mapped |= m
    return out, float(1 - mapped.mean())


def landsat_c2_st_to_celsius(dn: np.ndarray) -> np.ndarray:
    """Landsat C2 L2 ST_B10 digital numbers -> °C (DN 0 is fill)."""
    dn = dn.astype("float32")
    dn[dn == 0] = np.nan
    return dn * np.float32(LANDSAT_C2_ST_SCALE) + np.float32(LANDSAT_C2_ST_OFFSET) - np.float32(273.15)
