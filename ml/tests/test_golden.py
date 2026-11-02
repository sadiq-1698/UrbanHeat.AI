import json
import unittest

import numpy as np

from urbanheat_ml.features import FEATURE_NAMES, build_features, cell_size_m
from urbanheat_ml.golden import FIXTURE


def arr(values, h, w):
    return np.array([np.nan if v is None else v for v in values], dtype=np.float64).reshape(h, w)


class GoldenTest(unittest.TestCase):
    """The committed fixture is what the TypeScript implementation is tested against, so it must stay in sync with features.py.

    Recomputing from the *stored* inputs (not regenerating the scene) keeps this independent of numpy/scipy versions: if features.py
    changes, this fails until the fixture is regenerated (`python -m urbanheat_ml.golden`), after which the geo-core test checks the port.
    """

    def setUp(self):
        self.g = json.loads(FIXTURE.read_text())

    def test_python_features_reproduce_the_expected_arrays_from_the_stored_inputs(self):
        g, h, w = self.g, self.g["height"], self.g["width"]
        size = cell_size_m(g["res_lon"], g["res_lat"], g["lat_center"])
        self.assertAlmostEqual(size.dx_m, g["cell_dx_m"], places=9)
        f = build_features(arr(g["inputs"]["canopy"], h, w), arr(g["inputs"]["impervious"], h, w), arr(g["inputs"]["elevation"], h, w),
                           np.array(g["water"], dtype=bool).reshape(h, w), size)
        for name in FEATURE_NAMES:
            np.testing.assert_allclose(f[name], arr(g["features"][name], h, w), rtol=1e-12, atol=1e-12, equal_nan=True, err_msg=name)

    def test_scene_exercises_the_awkward_cases(self):
        g = self.g
        water = sum(g["water"])
        self.assertTrue(40 < water < 160, water)
        self.assertTrue(any(v is None for v in g["inputs"]["canopy"]))
        self.assertTrue(any(v is None for v in g["features"]["canopy_pct"]))
        self.assertFalse(all(v is None for v in g["features"]["canopy_mean_150m"]))
        self.assertTrue(g["cell_dx_m"] != g["cell_dy_m"], "cells must be anisotropic")


if __name__ == "__main__":
    unittest.main()
