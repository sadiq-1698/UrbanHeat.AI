"""Golden fixture for Python <-> TypeScript feature parity.

Generates a small seeded scene (NaN inputs, irregular water, anisotropic cells at 47.6 N), runs the Python feature code on it,
and writes inputs + expected outputs to packages/geo-core/test-fixtures/features-golden.json. Both test suites check it:
ml/tests/test_golden.py (Python must still reproduce it) and packages/geo-core/src/features-golden.test.ts (TypeScript must match it).

Regenerate after an intentional change to features.py:   .venv/bin/python -m urbanheat_ml.golden
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import ndimage

from .features import FEATURE_NAMES, build_features, cell_size_m

FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "geo-core" / "test-fixtures" / "features-golden.json"
W, H = 30, 26
RES_LON = RES_LAT = 0.0008333333333333334
LAT_CENTER = 47.625


def make_scene(seed: int = 2024) -> dict:
    rng = np.random.default_rng(seed)
    smooth = lambda s: ndimage.gaussian_filter(rng.standard_normal((H, W)), s)
    z = smooth(2.0)
    water = z > np.quantile(z, 0.9)                      # irregular lakes covering ~10% of cells
    canopy = np.clip(50 + 30 * smooth(1.5) / smooth(1.5).std(), 0, 100)
    impervious = np.clip(30 + 30 * smooth(1.5) / smooth(1.5).std(), 0, 100)
    elevation = 40 + 25 * smooth(3.0) / smooth(3.0).std()
    for a in (canopy, impervious, elevation):
        a[water] = 0
    canopy[3, 4] = np.nan                                  # missing inputs must propagate only where needed
    canopy[10:12, 20:22] = np.nan
    elevation[0, 0] = np.nan
    f32 = lambda a: a.astype(np.float32)
    return {"canopy": f32(canopy), "impervious": f32(impervious), "elevation": f32(elevation), "water": water}


def make_golden() -> dict:
    scene = make_scene()
    size = cell_size_m(RES_LON, RES_LAT, LAT_CENTER)
    feats = build_features(scene["canopy"], scene["impervious"], scene["elevation"], scene["water"], size)
    clean = lambda a: [None if np.isnan(v) else float(v) for v in a.ravel()]
    return {
        "width": W, "height": H, "res_lon": RES_LON, "res_lat": RES_LAT, "lat_center": LAT_CENTER,
        "cell_dx_m": size.dx_m, "cell_dy_m": size.dy_m,
        "inputs": {k: clean(scene[k]) for k in ("canopy", "impervious", "elevation")},
        "water": [int(v) for v in scene["water"].ravel()],
        "features": {n: clean(feats[n]) for n in FEATURE_NAMES},
    }


def main() -> None:
    g = make_golden()
    FIXTURE.write_text(json.dumps(g, separators=(",", ":"), allow_nan=False))
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size / 1e3:.0f} KB); water cells: {sum(g['water'])}/{W * H}")


if __name__ == "__main__":
    main()
