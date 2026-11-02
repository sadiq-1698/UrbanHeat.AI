import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine

from urbanheat_ml.dataset import MIN_REFERENCE_CELLS, build_dataset, spatial_folds, write_dataset
from urbanheat_ml.features import FEATURE_NAMES

H, W = 40, 50
RES = 0.001
WEST, NORTH = -122.5, 47.7


def make_region(root: Path, region="t", *, water_cols=(24, 26), nodata_cell=None, with_water_polygon=True):
    """A small synthetic region: dense (paved, hot) west, green (cool) east, a N-S river, on disk in the real layout."""
    rng = np.random.default_rng(1)
    yy, xx = np.mgrid[0:H, 0:W]
    imp = np.clip(90 - xx * 2.2 + rng.normal(0, 2, (H, W)), 0, 100)
    can = np.clip(xx * 2.0 + rng.normal(0, 2, (H, W)), 0, 100)
    elev = 10 + 0.5 * yy
    lst = 25 + 0.08 * imp - 0.05 * can + rng.normal(0, 0.1, (H, W))
    wmask = np.zeros((H, W), dtype=bool)
    wmask[:, water_cols[0]:water_cols[1]] = True
    imp[wmask] = 0
    can[wmask] = 0
    elev[wmask] = 0
    lst[wmask] = 21.0
    if nodata_cell:
        lst[nodata_cell] = -9999.0
    tf = Affine(RES, 0, WEST, 0, -RES, NORTH)
    for kind, arr in (("canopy", can), ("impervious", imp), ("elevation", elev), ("lst", lst)):
        p = root / "rasters" / f"{region}-{kind}.tif"
        p.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(p, "w", driver="GTiff", height=H, width=W, count=1, dtype="float32", crs="EPSG:4326", transform=tf, nodata=-9999.0) as d:
            d.write(arr.astype("float32"), 1)
    feats = []
    if with_water_polygon:
        w0, w1 = WEST + water_cols[0] * RES, WEST + water_cols[1] * RES
        s, n = NORTH - H * RES, NORTH
        feats.append({"type": "Feature", "properties": {"class": "water"}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[w0, s], [w1, s], [w1, n], [w0, n], [w0, s]]]]}})
    feats.append({"type": "Feature", "properties": {"class": "forest"}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[WEST, s], [WEST + 0.01, s], [WEST + 0.01, n], [WEST, n], [WEST, s]]]]}})
    (root / region).mkdir(parents=True, exist_ok=True)
    (root / region / "landcover.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    return wmask


class DatasetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.water = make_region(self.tmp)
        self.df, self.meta = build_dataset("t", self.tmp, block_m=1000, folds=3, seed=7)

    def test_columns_and_no_missing_values(self):
        for c in ("row", "col", "lon", "lat", "block_id", "fold", *FEATURE_NAMES, "is_water", "lst_c", "lst_anomaly_c"):
            self.assertIn(c, self.df.columns)
        self.assertFalse(self.df[list(FEATURE_NAMES) + ["lst_c", "lst_anomaly_c"]].isna().any().any())
        self.assertEqual(self.meta["features"], list(FEATURE_NAMES))

    def test_water_cells_are_excluded_by_default_and_included_on_request(self):
        self.assertEqual(len(self.df), H * W - int(self.water.sum()))
        self.assertFalse(self.df.is_water.any())
        self.assertEqual(self.meta["cells"]["water"], int(self.water.sum()))
        df2, _ = build_dataset("t", self.tmp, include_water=True)
        self.assertEqual(len(df2), H * W)
        self.assertEqual(int(df2.is_water.sum()), int(self.water.sum()))

    def test_rows_point_at_the_right_cells(self):
        r = self.df.iloc[123]
        self.assertAlmostEqual(r.lon, WEST + (r.col + 0.5) * RES, places=6)
        self.assertAlmostEqual(r.lat, NORTH - (r.row + 0.5) * RES, places=6)
        with rasterio.open(self.tmp / "rasters" / "t-impervious.tif") as s:
            self.assertAlmostEqual(r.impervious_pct, float(s.read(1)[int(r.row), int(r.col)]), places=2)

    def test_target_is_lst_minus_the_reference_baseline(self):
        np.testing.assert_allclose(self.df.lst_anomaly_c, self.df.lst_c - self.meta["baseline_lst_c"], atol=1e-4)
        # reference cells are cool (green, unpaved), so hot cells are positive anomalies
        self.assertEqual(self.meta["baseline"]["method"], "median of reference cells")
        self.assertGreaterEqual(self.meta["baseline"]["reference_cells"], MIN_REFERENCE_CELLS)
        west = self.df[self.df.col < 8]
        east = self.df[self.df.col > 40]
        self.assertGreater(west.lst_anomaly_c.mean(), 3.0)
        self.assertLess(east.lst_anomaly_c.mean(), 1.0)

    def test_spatial_blocks_never_straddle_folds_and_folds_are_used(self):
        self.assertEqual(int((self.df.groupby("block_id").fold.nunique() > 1).sum()), 0)
        self.assertEqual(sorted(self.df.fold.unique()), [0, 1, 2])
        self.assertEqual(sum(self.meta["spatial_cv"]["rows_per_fold"].values()), len(self.df))
        # blocks are ~1 km: 0.001° ≈ 75-111 m cells => a block holds several cells in each direction
        self.assertGreater(self.df.groupby("block_id").size().min(), 20)

    def test_deterministic_for_a_seed_and_different_across_seeds(self):
        again, _ = build_dataset("t", self.tmp, block_m=1000, folds=3, seed=7)
        np.testing.assert_array_equal(self.df.fold.to_numpy(), again.fold.to_numpy())
        other, _ = build_dataset("t", self.tmp, block_m=1000, folds=3, seed=8)
        self.assertFalse(np.array_equal(self.df.fold.to_numpy(), other.fold.to_numpy()))

    def test_no_coordinate_features(self):
        for banned in ("lon", "lat", "row", "col", "block_id", "fold"):
            self.assertNotIn(banned, FEATURE_NAMES)

    def test_nodata_lst_cells_are_dropped_and_counted(self):
        root = Path(tempfile.mkdtemp())
        make_region(root, nodata_cell=(5, 5))
        df, meta = build_dataset("t", root)
        self.assertEqual(meta["cells"]["dropped_incomplete"], 1)
        self.assertFalse(((df.row == 5) & (df.col == 5)).any())

    def test_few_reference_cells_fall_back_to_a_percentile_and_say_so(self):
        root = Path(tempfile.mkdtemp())
        make_region(root)
        for kind in ("canopy",):  # wipe the vegetation so no cell qualifies as reference
            p = root / "rasters" / f"t-{kind}.tif"
            with rasterio.open(p, "r+") as d:
                d.write(np.zeros((H, W), dtype="float32"), 1)
        _, meta = build_dataset("t", root)
        self.assertIn("too few reference cells", meta["baseline"]["method"])
        self.assertEqual(meta["baseline"]["reference_cells"], 0)

    def test_missing_inputs_and_mismatched_grids_are_clear_errors(self):
        with self.assertRaisesRegex(FileNotFoundError, "ingest"):
            build_dataset("nope", self.tmp)
        root = Path(tempfile.mkdtemp())
        make_region(root)
        bad = root / "rasters" / "t-lst.tif"
        with rasterio.open(bad, "w", driver="GTiff", height=H, width=W, count=1, dtype="float32", crs="EPSG:4326",
                           transform=Affine(RES, 0, WEST + 0.01, 0, -RES, NORTH), nodata=-9999.0) as d:
            d.write(np.zeros((H, W), dtype="float32"), 1)
        with self.assertRaisesRegex(ValueError, "grid differs"):
            build_dataset("t", root)

    def test_write_dataset_round_trips(self):
        import pandas as pd
        csv, mp = write_dataset(self.df, self.meta, self.tmp / "out")
        back = pd.read_csv(csv)
        self.assertEqual(len(back), len(self.df))
        self.assertEqual(json.loads(mp.read_text())["rows"], len(self.df))
        np.testing.assert_allclose(back.lst_c, self.df.lst_c, atol=1e-3)


class FoldsTest(unittest.TestCase):
    def test_round_robin_balance_over_blocks(self):
        blocks = np.repeat(np.arange(20), 5)
        folds = spatial_folds(blocks, 4, seed=1)
        per_fold_blocks = [len(np.unique(blocks[folds == k])) for k in range(4)]
        self.assertEqual(per_fold_blocks, [5, 5, 5, 5])
        for b in range(20):
            self.assertEqual(len(np.unique(folds[blocks == b])), 1)


if __name__ == "__main__":
    unittest.main()
