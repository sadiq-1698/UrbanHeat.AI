import tempfile
import unittest
from pathlib import Path

import numpy as np
from rasterio.enums import Resampling

from demo_city.grid import Grid
from demo_city.vectors import CLASS_IDS
from real_data.rasters import clip_to_grid, landsat_c2_st_to_celsius, nlcd_class_ids
from tests.helpers import write_projected

GRID = Grid.from_bbox(-122.50, 48.72, -122.46, 48.75, 0.0006)  # ~Bellingham, WA


class ClipTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_reprojects_to_grid_and_keeps_values(self):
        # West half 80, east half 20 (split at grid mid-longitude via x ordering).
        def canopy(rows, cols, x, y):
            return np.where(np.arange(cols)[None, :] < cols // 2, 80, 20) * np.ones((rows, 1))
        p = write_projected(self.tmp / "tcc.tif", canopy, GRID, nodata=255)
        out = clip_to_grid(p, GRID, valid_range=(0, 100))
        self.assertEqual(out.shape, (GRID.height, GRID.width))
        self.assertEqual(out.dtype, np.float32)
        self.assertAlmostEqual(float(np.nanmean(out[:, : GRID.width // 4])), 80, delta=2)
        self.assertAlmostEqual(float(np.nanmean(out[:, -GRID.width // 4:])), 20, delta=2)
        self.assertFalse(np.isnan(out).any())

    def test_fill_codes_are_masked_not_averaged(self):
        def imp(rows, cols, x, y):  # 30% everywhere with a block of NLCD fill (127)
            a = np.full((rows, cols), 30)
            a[rows // 3: rows // 2, cols // 3: cols // 2] = 127
            return a
        p = write_projected(self.tmp / "imp.tif", imp, GRID)
        out = clip_to_grid(p, GRID, valid_range=(0, 100))
        self.assertTrue(np.isnan(out).any())
        self.assertEqual(float(np.nanmax(out)), 30.0)  # no 127-contaminated edge cells

    def test_nearest_keeps_class_codes_integral(self):
        def lc(rows, cols, x, y):
            return np.where(np.arange(cols)[None, :] < cols // 2, 41, 24) * np.ones((rows, 1))
        p = write_projected(self.tmp / "lc.tif", lc, GRID)
        out = clip_to_grid(p, GRID, resampling=Resampling.nearest)
        self.assertEqual(set(np.unique(out[~np.isnan(out)])), {24.0, 41.0})

    def test_non_overlapping_bbox_raises(self):
        p = write_projected(self.tmp / "tcc.tif", lambda r, c, x, y: np.full((r, c), 5), GRID)
        far = Grid.from_bbox(-100.0, 40.0, -99.9, 40.1, 0.001)
        with self.assertRaises(ValueError):
            clip_to_grid(p, far)


class ConversionTest(unittest.TestCase):
    def test_nlcd_mapping(self):
        ids, unmapped = nlcd_class_ids(np.array([[11, 24, 41], [90, 82, np.nan]], dtype="float32"))
        self.assertEqual(ids[0, 0], CLASS_IDS["water"])
        self.assertEqual(ids[0, 1], CLASS_IDS["developed_high"])
        self.assertEqual(ids[1, 0], CLASS_IDS["wetland"])
        self.assertEqual(ids[1, 1], CLASS_IDS["cropland"])
        self.assertEqual(ids[1, 2], CLASS_IDS["barren"])
        self.assertAlmostEqual(unmapped, 1 / 6)

    def test_landsat_dn_to_celsius(self):
        # DN 0 is fill; DN 44000 -> 149 + 150.39 K = 299.39 K = 26.24 °C
        out = landsat_c2_st_to_celsius(np.array([0, 44000], dtype="uint16"))
        self.assertTrue(np.isnan(out[0]))
        self.assertAlmostEqual(float(out[1]), 26.24, places=1)


if __name__ == "__main__":
    unittest.main()
