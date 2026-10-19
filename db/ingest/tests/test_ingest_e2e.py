import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio

from demo_city.grid import Grid
from real_data.ingest import ingest, parse_args
from tests.helpers import write_projected

BBOX = (-122.50, 48.72, -122.46, 48.75)
GRID = Grid.from_bbox(*BBOX, 0.0003)


class IngestE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        t = cls.tmp
        # West half forest (NLCD 41), east half high-intensity developed (24), river strip (11).
        def land(rows, cols, x, y):
            a = np.where(np.arange(cols)[None, :] < cols // 2, 41, 24) * np.ones((rows, 1))
            a[:, cols // 2 - 3: cols // 2 + 3] = 11
            return a
        def canopy(rows, cols, x, y):
            return np.where(np.arange(cols)[None, :] < cols // 2, 85, 5) * np.ones((rows, 1))
        def imperv(rows, cols, x, y):
            return np.where(np.arange(cols)[None, :] < cols // 2, 3, 90) * np.ones((rows, 1))
        def lst_dn(rows, cols, x, y):  # forest ~24 °C, city ~38 °C as Landsat C2 DNs
            c = np.where(np.arange(cols)[None, :] < cols // 2, 24.0, 38.0) * np.ones((rows, 1))
            return (c + 273.15 - 149.0) / 0.00341802
        write_projected(t / "lc.tif", land, GRID)
        write_projected(t / "tcc.tif", canopy, GRID, nodata=255)
        write_projected(t / "imp.tif", imperv, GRID)
        write_projected(t / "st.tif", lst_dn, GRID, dtype="uint16", nodata=0)
        write_projected(t / "dem.tif", lambda r, c, x, y: np.full((r, c), 12.5), GRID, dtype="float32")
        (t / "obs.csv").write_text(
            "station_id,name,lat,lon,timestamp,temp\n"
            "K1,Forest,48.735,-122.495,2025-07-15T22:00:00Z,24.5\n"
            "K2,Downtown,48.735,-122.465,2025-07-15T22:00:00Z,33.0\n")
        args = parse_args([
            "--region", "e2e", "--bbox", *map(str, BBOX), "--nlcd-landcover", str(t / "lc.tif"),
            "--nlcd-canopy", str(t / "tcc.tif"), "--nlcd-impervious", str(t / "imp.tif"),
            "--lst", str(t / "st.tif"), "--dem", str(t / "dem.tif"),
            "--stations-csv", str(t / "obs.csv"), "--station-source", "test", "--out", str(t / "out")])
        cls.summary = ingest(args)
        cls.out = t / "out"

    def read_tif(self, kind):
        with rasterio.open(self.out / "rasters" / f"e2e-{kind}.tif") as src:
            a = src.read(1)
            return src, np.where(a == src.nodata, np.nan, a)

    def test_rasters_aligned_to_grid(self):
        for kind in ("canopy", "impervious", "lst", "elevation"):
            src, a = self.read_tif(kind)
            self.assertEqual((src.width, src.height), (GRID.width, GRID.height))
            self.assertEqual(src.crs.to_epsg(), 4326)
            self.assertEqual(src.transform.c, GRID.west)

    def test_values_survive_reprojection_and_unit_conversion(self):
        _, lst = self.read_tif("lst")
        self.assertAlmostEqual(float(np.nanmean(lst[:, :10])), 24.0, delta=0.5)
        self.assertAlmostEqual(float(np.nanmean(lst[:, -10:])), 38.0, delta=0.5)
        _, el = self.read_tif("elevation")
        self.assertAlmostEqual(float(np.nanmean(el)), 12.5, places=1)

    def test_landcover_polygons_follow_nlcd(self):
        feats = json.loads((self.out / "e2e" / "landcover.geojson").read_text())["features"]
        classes = {f["properties"]["class"] for f in feats}
        self.assertEqual(classes, {"forest", "developed_high", "water"})
        forest = next(f["properties"] for f in feats if f["properties"]["class"] == "forest")
        city = next(f["properties"] for f in feats if f["properties"]["class"] == "developed_high")
        self.assertGreater(forest["canopy_pct"], 70)
        self.assertGreater(city["impervious_pct"], 70)
        self.assertEqual(self.summary["unmapped_landcover"], 0.0)

    def test_stations_and_manifest(self):
        st = json.loads((self.out / "e2e" / "stations.json").read_text())
        self.assertEqual([s["station_id"] for s in st["stations"]], ["K1", "K2"])
        self.assertEqual(st["stations"][0]["source"], "test")
        self.assertEqual(len(st["observations"]), 2)
        man = json.loads((self.out / "e2e" / "manifest.json").read_text())
        self.assertEqual({r["kind"] for r in man["rasters"]}, {"canopy", "impervious", "lst", "elevation"})
        self.assertEqual(man["bbox"][0], GRID.west)

    def test_bbox_outside_landcover_coverage_aborts(self):
        far = ["--region", "x", "--bbox", "-100", "40", "-99.9", "40.1", "--nlcd-landcover",
               str(self.tmp / "lc.tif"), "--nlcd-canopy", str(self.tmp / "tcc.tif"),
               "--nlcd-impervious", str(self.tmp / "imp.tif"), "--lst", str(self.tmp / "st.tif"),
               "--out", str(self.tmp / "far")]
        with self.assertRaises(ValueError):
            ingest(parse_args(far))


if __name__ == "__main__":
    unittest.main()
