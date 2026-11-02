import math
import unittest

import numpy as np

from urbanheat_ml.features import (DIST_CAP_M, FEATURE_NAMES, CellSize, box_fraction, box_mean, build_features,
                                   cell_size_m, distance_to_mask, half_widths)

SIZE = CellSize(dx_m=100.0, dy_m=100.0)


class CellSizeTest(unittest.TestCase):
    def test_cell_size_shrinks_with_latitude(self):
        eq = cell_size_m(0.001, 0.001, 0)
        n = cell_size_m(0.001, 0.001, 60)
        self.assertAlmostEqual(eq.dx_m, 111.195, delta=0.01)
        self.assertAlmostEqual(eq.dy_m, 111.195, delta=0.01)
        self.assertAlmostEqual(n.dx_m / eq.dx_m, 0.5, places=6)
        self.assertAlmostEqual(n.dy_m, eq.dy_m)

    def test_half_widths_round_half_up_and_floor_at_one(self):
        self.assertEqual(half_widths(150, CellSize(100, 100)), (2, 2))   # 1.5 -> 2 (half up, not banker's)
        self.assertEqual(half_widths(250, CellSize(100, 100)), (3, 3))   # 2.5 -> 3
        self.assertEqual(half_widths(10, CellSize(100, 100)), (1, 1))    # never below 1 cell
        self.assertEqual(half_widths(1000, CellSize(50, 200)), (20, 5))  # anisotropic cells


class BoxMeanTest(unittest.TestCase):
    def test_matches_brute_force_with_nan_and_edges(self):
        rng = np.random.default_rng(0)
        a = rng.uniform(0, 100, (9, 11))
        a[rng.random(a.shape) < 0.2] = np.nan
        for kx, ky in ((1, 1), (2, 1), (1, 3), (4, 4)):
            got = box_mean(a, kx, ky)
            for r in range(a.shape[0]):
                for c in range(a.shape[1]):
                    w = a[max(0, r - ky): r + ky + 1, max(0, c - kx): c + kx + 1]
                    exp = np.nanmean(w) if np.isfinite(w).any() else np.nan
                    if np.isnan(exp):
                        self.assertTrue(np.isnan(got[r, c]))
                    else:
                        self.assertAlmostEqual(got[r, c], exp, places=9, msg=f"k=({kx},{ky}) r={r} c={c}")

    def test_valid_mask_excludes_cells(self):
        a = np.array([[10.0, 20.0, 30.0]])
        valid = np.array([[True, False, True]])
        out = box_mean(a, 1, 1, valid=valid)
        self.assertAlmostEqual(out[0, 0], 10.0)   # sees cells 0 and 1; only 0 is valid
        self.assertAlmostEqual(out[0, 1], 20.0)   # sees 0, 1, 2; valid are 10 and 30
        self.assertAlmostEqual(out[0, 2], 30.0)

    def test_all_invalid_window_is_nan(self):
        a = np.array([[1.0, 2.0, 3.0, 4.0, 5.0]])
        valid = np.array([[True, False, False, False, False]])
        out = box_mean(a, 1, 1, valid=valid)
        self.assertEqual(out[0, 0], 1.0)
        self.assertTrue(np.isnan(out[0, 3]) and np.isnan(out[0, 4]))

    def test_fraction_counts_clipped_window_size(self):
        m = np.zeros((3, 3), dtype=bool)
        m[0, 0] = True
        f = box_fraction(m, 1, 1)
        self.assertAlmostEqual(f[0, 0], 1 / 4)      # corner window has only 4 cells
        self.assertAlmostEqual(f[1, 1], 1 / 9)
        self.assertAlmostEqual(f[2, 2], 0.0)


class DistanceTest(unittest.TestCase):
    def test_isotropic_distances_and_cap(self):
        m = np.zeros((1, 7), dtype=bool)
        m[0, 0] = True
        d = distance_to_mask(m, CellSize(100, 100), cap=350)
        np.testing.assert_allclose(d[0], [0, 100, 200, 300, 350, 350, 350])

    def test_anisotropic_cells_use_ground_metres(self):
        m = np.zeros((5, 5), dtype=bool)
        m[2, 2] = True
        d = distance_to_mask(m, CellSize(dx_m=50, dy_m=200))
        self.assertAlmostEqual(d[2, 3], 50)
        self.assertAlmostEqual(d[3, 2], 200)
        self.assertAlmostEqual(d[3, 3], math.hypot(50, 200))

    def test_no_water_means_cap_everywhere(self):
        d = distance_to_mask(np.zeros((3, 3), dtype=bool), SIZE)
        self.assertTrue(np.all(d == DIST_CAP_M))


class BuildFeaturesTest(unittest.TestCase):
    def setUp(self):
        h, w = 12, 14
        rng = np.random.default_rng(3)
        self.canopy = rng.uniform(0, 80, (h, w))
        self.imp = rng.uniform(0, 90, (h, w))
        self.elev = rng.uniform(0, 100, (h, w))
        self.water = np.zeros((h, w), dtype=bool)
        self.water[:, 6:8] = True  # a N-S river two cells wide
        self.canopy[self.water] = 0
        self.imp[self.water] = 0
        self.elev[self.water] = 0
        self.f = build_features(self.canopy, self.imp, self.elev, self.water, SIZE)

    def test_names_order_and_shapes(self):
        self.assertEqual(tuple(self.f), FEATURE_NAMES)
        self.assertEqual(len(FEATURE_NAMES), 12)
        for v in self.f.values():
            self.assertEqual(v.shape, self.canopy.shape)

    def test_own_values_pass_through(self):
        np.testing.assert_array_equal(self.f["canopy_pct"], self.canopy)
        np.testing.assert_array_equal(self.f["elevation_m"], self.elev)

    def test_neighbourhood_means_ignore_water_cells(self):
        # A land cell next to the river: its 150 m mean (k=2 cells) must average land cells only.
        r, c = 5, 5
        win = (slice(max(0, r - 2), r + 3), slice(max(0, c - 2), c + 3))
        land = ~self.water[win]
        self.assertAlmostEqual(self.f["canopy_mean_150m"][r, c], self.canopy[win][land].mean(), places=9)
        # ...which differs from the naive mean that counts the zeros of the water cells
        self.assertNotAlmostEqual(self.f["canopy_mean_150m"][r, c], self.canopy[win].mean(), places=3)

    def test_water_features(self):
        self.assertEqual(self.f["dist_water_m"][0, 6], 0.0)
        self.assertAlmostEqual(self.f["dist_water_m"][0, 4], 200.0)   # two cells west of the river
        self.assertAlmostEqual(self.f["dist_water_m"][0, 9], 200.0)   # two cells east (col 7 is the last water col)
        self.assertGreater(self.f["water_frac_500m"][0, 5], self.f["water_frac_500m"][0, 0])
        self.assertTrue(np.all((self.f["water_frac_500m"] >= 0) & (self.f["water_frac_500m"] <= 1)))

    def test_relief_is_zero_mean_ish_and_flat_terrain_has_none(self):
        flat = build_features(self.canopy, self.imp, np.full_like(self.elev, 40.0), self.water, SIZE)
        np.testing.assert_allclose(flat["elev_rel_1000m"], 0.0, atol=1e-9)
        peak = self.elev.copy()
        peak[6, 3] = 500
        rel = build_features(self.canopy, self.imp, peak, self.water, SIZE)["elev_rel_1000m"]
        self.assertGreater(rel[6, 3], 300)

    def test_nan_inputs_propagate_only_where_needed(self):
        canopy = self.canopy.copy()
        canopy[2, 2] = np.nan
        f = build_features(canopy, self.imp, self.elev, self.water, SIZE)
        self.assertTrue(np.isnan(f["canopy_pct"][2, 2]))
        self.assertFalse(np.isnan(f["canopy_mean_150m"][2, 2]))      # neighbours still inform it
        self.assertFalse(np.isnan(f["impervious_pct"][2, 2]))


if __name__ == "__main__":
    unittest.main()
