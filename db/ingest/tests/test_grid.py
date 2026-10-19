import unittest

from demo_city.grid import Grid


class GridTest(unittest.TestCase):
    def test_from_bbox_covers_bbox_and_rounds_outward(self):
        g = Grid.from_bbox(-122.5, 48.7, -122.4, 48.8, 0.03)
        self.assertEqual((g.width, g.height), (4, 4))  # ceil(0.1/0.03)
        self.assertEqual((g.west, g.north), (-122.5, 48.8))
        self.assertGreaterEqual(g.east, -122.4)
        self.assertLessEqual(g.south, 48.7)

    def test_from_bbox_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            Grid.from_bbox(1, 0, 0, 1, 0.1)
        with self.assertRaises(ValueError):
            Grid.from_bbox(0, 0, 1, 1, 0)


if __name__ == "__main__":
    unittest.main()
