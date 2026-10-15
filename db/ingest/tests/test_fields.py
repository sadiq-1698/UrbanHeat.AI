import unittest

import numpy as np

from demo_city.fields import synthesize
from demo_city.grid import Grid


class FieldsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.grid = Grid()
        cls.f = synthesize(cls.grid, seed=7)

    def test_shapes_and_dtypes(self):
        for k in ("canopy", "impervious", "elevation", "lst"):
            self.assertEqual(self.f[k].shape, (self.grid.height, self.grid.width))
            self.assertEqual(self.f[k].dtype, np.float32)
        self.assertEqual(self.f["water"].dtype, bool)

    def test_percent_ranges(self):
        for k in ("canopy", "impervious"):
            self.assertGreaterEqual(self.f[k].min(), 0)
            self.assertLessEqual(self.f[k].max(), 100)

    def test_deterministic_for_same_seed(self):
        again = synthesize(self.grid, seed=7)
        np.testing.assert_array_equal(self.f["lst"], again["lst"])
        self.assertFalse(np.array_equal(self.f["lst"], synthesize(self.grid, seed=8)["lst"]))

    def test_lst_tracks_drivers_on_land(self):
        land = ~self.f["water"]
        corr = lambda a, b: np.corrcoef(self.f[a][land], self.f[b][land])[0, 1]
        self.assertGreater(corr("lst", "impervious"), 0.5)
        self.assertLess(corr("lst", "canopy"), -0.3)

    def test_water_is_present_and_cool(self):
        water = self.f["water"]
        self.assertTrue(0.02 < water.mean() < 0.3)
        self.assertLess(self.f["lst"][water].mean(), self.f["lst"][~water].mean() - 3)
        self.assertEqual(self.f["impervious"][water].max(), 0)

    def test_plausible_temperature_range(self):
        self.assertGreater(self.f["lst"].min(), 15)
        self.assertLess(self.f["lst"].max(), 45)


if __name__ == "__main__":
    unittest.main()
