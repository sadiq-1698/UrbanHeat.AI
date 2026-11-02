"""Per-cell features for the heat model.

SPECIFICATION (mirrored exactly by packages/geo-core/src/features.ts; tests compare the two on a golden fixture)

Inputs, all on one regular lon/lat grid (row 0 = north), float arrays with NaN for no-data:
  canopy (%), impervious (%), elevation (m), water (bool: open water)
Cell size in metres, from the grid centre latitude (spherical Earth, R = 6371008.8 m):
  dy_m = res_lat * R * pi/180            dx_m = res_lon * R * pi/180 * cos(lat_center)

Neighbourhood statistics use a *rectangular* window of half-widths
  kx = max(1, floor(radius_m / dx_m + 0.5)),  ky = max(1, floor(radius_m / dy_m + 0.5))   (cells)
clipped at the grid edge, and average only valid (non-NaN) cells. Water cells are excluded from the canopy and
impervious means (their canopy/impervious are 0 by construction, which would read as "bare ground"); the share of
water is a separate feature.

Features (FEATURE_NAMES order is the model's input order):
  canopy_pct, impervious_pct                  the cell's own values
  canopy_mean_{150,500,1000}m                 mean canopy of non-water cells in the window
  impervious_mean_{150,500,1000}m             same for impervious
  elevation_m                                 the cell's elevation
  elev_rel_1000m                              elevation minus the 1000 m window mean of elevation (local relief)
  dist_water_m                                Euclidean distance to the nearest water cell, capped at DIST_CAP_M
  water_frac_500m                             share of window cells that are water

Deliberately *not* features: longitude/latitude/row/col (they would let a model memorise places and would not transfer
to a new city); they are kept as dataset columns for spatial cross-validation only.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import ndimage

EARTH_RADIUS_M = 6_371_008.8
DIST_CAP_M = 5000.0
RADII_M = (150, 500, 1000)

FEATURE_NAMES = (
    "canopy_pct",
    "impervious_pct",
    "canopy_mean_150m",
    "canopy_mean_500m",
    "canopy_mean_1000m",
    "impervious_mean_150m",
    "impervious_mean_500m",
    "impervious_mean_1000m",
    "elevation_m",
    "elev_rel_1000m",
    "dist_water_m",
    "water_frac_500m",
)


@dataclass(frozen=True)
class CellSize:
    dx_m: float
    dy_m: float


def cell_size_m(res_lon: float, res_lat: float, lat_center: float) -> CellSize:
    """Ground size of one cell in metres (spherical Earth), evaluated at the grid's centre latitude."""
    m_per_deg = EARTH_RADIUS_M * math.pi / 180.0
    return CellSize(dx_m=res_lon * m_per_deg * math.cos(math.radians(lat_center)), dy_m=res_lat * m_per_deg)


def half_widths(radius_m: float, size: CellSize) -> tuple[int, int]:
    """(kx, ky) window half-widths in cells for a ground radius; at least 1 cell, rounding half up."""
    return max(1, math.floor(radius_m / size.dx_m + 0.5)), max(1, math.floor(radius_m / size.dy_m + 0.5))


def _window_sums(a: np.ndarray, kx: int, ky: int) -> np.ndarray:
    """Sum over the (2ky+1) x (2kx+1) window around every cell, clipped at the edges (integral image)."""
    h, w = a.shape
    ii = np.zeros((h + 1, w + 1), dtype=np.float64)
    ii[1:, 1:] = a.cumsum(axis=0).cumsum(axis=1)
    r0 = np.clip(np.arange(h) - ky, 0, h)[:, None]
    r1 = np.clip(np.arange(h) + ky + 1, 0, h)[:, None]
    c0 = np.clip(np.arange(w) - kx, 0, w)[None, :]
    c1 = np.clip(np.arange(w) + kx + 1, 0, w)[None, :]
    return ii[r1, c1] - ii[r0, c1] - ii[r1, c0] + ii[r0, c0]


def box_mean(a: np.ndarray, kx: int, ky: int, valid: np.ndarray | None = None) -> np.ndarray:
    """Mean over the window of the cells where `valid` (default: non-NaN) holds; NaN where no valid cell is in range."""
    ok = ~np.isnan(a) if valid is None else (valid & ~np.isnan(a))
    total = _window_sums(np.where(ok, a, 0.0), kx, ky)
    count = _window_sums(ok.astype(np.float64), kx, ky)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / count, np.nan)


def box_fraction(mask: np.ndarray, kx: int, ky: int) -> np.ndarray:
    """Share of window cells where `mask` is true (all cells count, including those at the grid edge window)."""
    return _window_sums(mask.astype(np.float64), kx, ky) / _window_sums(np.ones(mask.shape, dtype=np.float64), kx, ky)


def distance_to_mask(mask: np.ndarray, size: CellSize, cap: float = DIST_CAP_M) -> np.ndarray:
    """Euclidean distance (m) from each cell to the nearest True cell, capped; `cap` everywhere if there is none."""
    if not mask.any():
        return np.full(mask.shape, cap, dtype=np.float64)
    d = ndimage.distance_transform_edt(~mask, sampling=(size.dy_m, size.dx_m))
    return np.minimum(d, cap)


def build_features(canopy: np.ndarray, impervious: np.ndarray, elevation: np.ndarray, water: np.ndarray, size: CellSize) -> dict[str, np.ndarray]:
    """All FEATURE_NAMES as float64 arrays shaped like the inputs. Cells lacking a needed input stay NaN."""
    land = ~water
    f: dict[str, np.ndarray] = {"canopy_pct": canopy.astype(np.float64), "impervious_pct": impervious.astype(np.float64)}
    for r in RADII_M:
        kx, ky = half_widths(r, size)
        f[f"canopy_mean_{r}m"] = box_mean(canopy.astype(np.float64), kx, ky, valid=land)
        f[f"impervious_mean_{r}m"] = box_mean(impervious.astype(np.float64), kx, ky, valid=land)
    kx1, ky1 = half_widths(1000, size)
    elev = elevation.astype(np.float64)
    f["elevation_m"] = elev
    f["elev_rel_1000m"] = elev - box_mean(elev, kx1, ky1)
    f["dist_water_m"] = distance_to_mask(water, size)
    kx5, ky5 = half_widths(500, size)
    f["water_frac_500m"] = box_fraction(water, kx5, ky5)
    return {k: f[k] for k in FEATURE_NAMES}
