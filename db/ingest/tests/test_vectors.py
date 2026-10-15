import unittest

import numpy as np
from shapely.geometry import shape

from demo_city.fields import synthesize
from demo_city.grid import Grid
from demo_city.vectors import CLASS_IDS, landcover_features, make_observations, make_stations


class VectorsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.grid = Grid()
        cls.f = synthesize(cls.grid, seed=7)
        cls.features = landcover_features(cls.f, cls.grid)
        cls.stations = make_stations(cls.f, cls.grid, seed=7)

    def test_landcover_polygons_are_valid_multipolygons_in_bbox(self):
        self.assertGreater(len(self.features), 10)
        for ft in self.features:
            self.assertEqual(ft["geometry"]["type"], "MultiPolygon")
            g = shape(ft["geometry"])
            self.assertTrue(g.is_valid)
            w, s, e, n = g.bounds
            self.assertGreaterEqual(w, self.grid.west - 1e-9)
            self.assertLessEqual(e, self.grid.east + 1e-9)
            self.assertGreaterEqual(s, self.grid.south - 1e-9)
            self.assertLessEqual(n, self.grid.north + 1e-9)

    def test_landcover_attributes_fit_schema(self):
        for ft in self.features:
            p = ft["properties"]
            self.assertIn(p["class"], CLASS_IDS)
            self.assertTrue(0 <= p["canopy_pct"] <= 100)
            self.assertTrue(0 <= p["impervious_pct"] <= 100)

    def test_water_polygons_have_near_zero_cover(self):
        # Not exactly 0: sieving merges tiny land specks into surrounding water.
        water = [ft["properties"] for ft in self.features if ft["properties"]["class"] == "water"]
        self.assertTrue(water)
        self.assertTrue(all(p["canopy_pct"] < 2 and p["impervious_pct"] < 2 for p in water))

    def test_stations_on_land_and_separated(self):
        self.assertEqual(len(self.stations), 24)
        for s in self.stations:
            r, c = self.grid.xy_to_rowcol(s["lon"], s["lat"])
            self.assertFalse(self.f["water"][r, c])
        self.assertEqual(len({s["station_id"] for s in self.stations}), 24)

    def test_observations_cover_24_hours_and_track_surface_heat(self):
        obs = make_observations(self.stations, seed=7)
        self.assertEqual(len(obs), 24 * len(self.stations))
        # Afternoon (22:00 UTC = 15:00 local): hotter surfaces should read warmer.
        pm = {o["station_id"]: o["temp_c"] for o in obs if o["observed_at"].startswith("2025-07-15T22")}
        ids = [s["station_id"] for s in self.stations]
        corr = np.corrcoef([s["lst_c"] for s in self.stations], [pm[i] for i in ids])[0, 1]
        self.assertGreater(corr, 0.6)
        self.assertTrue(all(0 <= o["humidity_pct"] <= 100 and o["wind_ms"] >= 0 for o in obs))


if __name__ == "__main__":
    unittest.main()
