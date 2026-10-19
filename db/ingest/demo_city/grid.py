"""Shared grid definition for the synthetic demo city (EPSG:4326)."""
import math
from dataclasses import dataclass

import numpy as np
from rasterio.transform import Affine, from_origin

REGION = "demo-city"


@dataclass(frozen=True)
class Grid:
    west: float = -122.55
    north: float = 47.70
    width: int = 240
    height: int = 180
    res: float = 0.2 / 240  # degrees per pixel (~57 m E-W, ~93 m N-S at 47.6°N)

    @classmethod
    def from_bbox(cls, west: float, south: float, east: float, north: float, res: float) -> "Grid":
        """Square-degree grid covering the bbox (east/south edges round outward)."""
        if not (west < east and south < north and res > 0):
            raise ValueError("bbox must satisfy west < east, south < north, and res > 0")
        return cls(west=west, north=north, width=math.ceil((east - west) / res),
                   height=math.ceil((north - south) / res), res=res)

    @property
    def east(self) -> float:
        return self.west + self.width * self.res

    @property
    def south(self) -> float:
        return self.north - self.height * self.res

    @property
    def transform(self) -> Affine:
        return from_origin(self.west, self.north, self.res, self.res)

    def lonlat_grids(self) -> tuple[np.ndarray, np.ndarray]:
        """Pixel-centre (lon, lat) arrays shaped (height, width)."""
        lons = self.west + (np.arange(self.width) + 0.5) * self.res
        lats = self.north - (np.arange(self.height) + 0.5) * self.res
        return np.meshgrid(lons, lats)

    def xy_to_rowcol(self, lon: float, lat: float) -> tuple[int, int]:
        col = int((lon - self.west) / self.res)
        row = int((self.north - lat) / self.res)
        return min(max(row, 0), self.height - 1), min(max(col, 0), self.width - 1)
