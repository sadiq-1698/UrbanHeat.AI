"""Synthesizes physically plausible fields for the demo city.

Land surface temperature (LST) is *derived* from impervious cover, canopy,
elevation and proximity to water — the same relationships the Session 14 model
has to recover. The coefficients are invented for the demo, not calibrated to a
real city, so model metrics on this data are demo-grade only.
"""
import numpy as np

from .grid import Grid


def gaussian_blur(a: np.ndarray, sigma_px: float) -> np.ndarray:
    """Gaussian smoothing via FFT (periodic edges; fine for smooth demo fields)."""
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    kernel = np.exp(-2 * (np.pi * sigma_px) ** 2 * (fx**2 + fy**2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * kernel))


def smooth_noise(rng: np.random.Generator, shape, sigma_px: float) -> np.ndarray:
    """Zero-mean, unit-std spatially correlated noise."""
    n = gaussian_blur(rng.standard_normal(shape), sigma_px)
    return (n - n.mean()) / n.std()


def _blob(u, v, cu, cv, sigma):
    return np.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (2 * sigma**2))


def synthesize(grid: Grid | None = None, seed: int = 42) -> dict[str, np.ndarray]:
    """Return float32 arrays: canopy, impervious (percent), elevation (m),
    lst (°C), plus a boolean `water` mask. All shaped (height, width)."""
    grid = grid or Grid()
    rng = np.random.default_rng(seed)
    shape = (grid.height, grid.width)
    # Normalised coords with y flipped so v grows northward.
    u, v = np.meshgrid(np.linspace(0, 1, grid.width), np.linspace(1, 0, grid.height))
    aspect = grid.width / grid.height  # keep blobs roughly round on screen
    ua = u * aspect

    # Water: a sinuous river plus a lake.
    river_v = 0.30 + 0.07 * np.sin(2 * np.pi * 1.3 * u + 0.8)
    river = np.abs(v - river_v) < 0.028
    lake = ((u - 0.22) ** 2 * aspect**2 + (v - 0.72) ** 2) < 0.07**2
    water = river | lake

    # Urban intensity: downtown core + two secondary centres over a low base.
    urban = (
        0.10
        + 0.85 * _blob(ua, v, 0.55 * aspect, 0.50, 0.14)
        + 0.55 * _blob(ua, v, 0.18 * aspect, 0.40, 0.09)
        + 0.45 * _blob(ua, v, 0.85 * aspect, 0.75, 0.08)
    )
    urban = np.clip(urban * (1 + 0.15 * smooth_noise(rng, shape, 6)), 0, 1)

    # Parks: cool, green pockets inside the urban area.
    parks = sum(_blob(ua, v, cu * aspect, cv, s) for cu, cv, s in
                [(0.50, 0.58, 0.035), (0.62, 0.42, 0.03), (0.30, 0.45, 0.03)])
    parks = np.clip(parks, 0, 1)

    impervious = np.clip(urban * 92 * (1 - 0.8 * parks) + 4 * smooth_noise(rng, shape, 2), 0, 100)
    canopy = np.clip(
        78 * (1 - urban) ** 1.3 + 45 * parks + 7 * smooth_noise(rng, shape, 3), 0, 100
    )
    canopy = np.minimum(canopy, 100 - 0.5 * impervious)  # canopy may overhang pavement, not fully
    impervious[water] = 0
    canopy[water] = 0

    # Elevation: rolling hills, higher in the north-east, ~0 at the river.
    elevation = np.clip(
        10 + 90 * (0.5 * u + 0.5 * v) ** 1.5 + 25 * smooth_noise(rng, shape, 10), 0, None
    )
    elevation[water] = 0

    # LST: derived from the drivers + smooth residual noise. Water pixels sit at
    # a cool, near-constant temperature; land near water gets a cooling halo.
    near_water = gaussian_blur(water.astype(float), 5)
    lst = (
        31.0
        + 0.085 * impervious
        - 0.060 * canopy
        - 0.0065 * elevation
        - 3.0 * near_water
        + 0.5 * smooth_noise(rng, shape, 4)
    )
    lst[water] = 22.0 + 0.3 * smooth_noise(rng, shape, 3)[water]

    f32 = lambda a: a.astype(np.float32)
    return {
        "canopy": f32(canopy),
        "impervious": f32(impervious),
        "elevation": f32(elevation),
        "lst": f32(lst),
        "water": water,
    }
