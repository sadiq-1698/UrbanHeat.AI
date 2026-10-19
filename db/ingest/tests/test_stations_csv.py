import tempfile
import unittest
from pathlib import Path

from real_data.stations import read_stations_csv

BBOX = (-122.6, 48.6, -122.3, 48.9)
HEADER = "station_id,name,lat,lon,elevation_m,timestamp,temp,humidity_pct,wind\n"


def write(text: str) -> Path:
    p = Path(tempfile.mkdtemp()) / "obs.csv"
    p.write_text(text)
    return p


class StationsCsvTest(unittest.TestCase):
    def test_parses_stations_and_observations(self):
        p = write(HEADER +
                  "A,Airport,48.80,-122.54,50,2025-07-15T20:00:00Z,86,40,10\n"
                  "A,Airport,48.80,-122.54,50,2025-07-15T21:00:00Z,90,35,12\n"
                  "B,Harbor,48.74,-122.49,3,2025-07-15 20:00:00,70,60,\n")
        stations, obs, stats = read_stations_csv(p, BBOX, temp_unit="f", wind_unit="mph", source="noaa-isd")
        self.assertEqual([s["station_id"] for s in stations], ["A", "B"])
        self.assertEqual(stations[0]["source"], "noaa-isd")
        self.assertEqual(stations[0]["elevation_m"], 50.0)
        self.assertEqual(len(obs), 3)
        self.assertAlmostEqual(obs[0]["temp_c"], 30.0, places=1)       # 86 °F
        self.assertAlmostEqual(obs[0]["wind_ms"], 4.5, places=1)       # 10 mph
        self.assertEqual(obs[2]["observed_at"], "2025-07-15T20:00:00+00:00")  # naive = UTC
        self.assertIsNone(obs[2]["wind_ms"])
        self.assertEqual(stats["rows"], 3)

    def test_skips_bad_rows_and_counts_them(self):
        p = write(HEADER +
                  "A,A,48.80,-122.54,,2025-07-15T20:00:00Z,25,,\n"
                  "OUT,Far,40.0,-100.0,,2025-07-15T20:00:00Z,25,,\n"
                  "NOLAT,X,,,,2025-07-15T20:00:00Z,25,,\n"
                  "HOT,H,48.80,-122.54,,2025-07-15T21:00:00Z,999,,\n"
                  "BADTS,T,48.80,-122.54,,yesterday,25,,\n")
        stations, obs, stats = read_stations_csv(p, BBOX)
        self.assertEqual([s["station_id"] for s in stations], ["A"])
        self.assertEqual(len(obs), 1)
        self.assertEqual(stats["skipped_outside_bbox"], 1)
        self.assertEqual(stats["skipped_incomplete"], 2)
        self.assertEqual(stats["skipped_implausible_temp"], 1)

    def test_duplicates_keep_last_and_are_counted(self):
        p = write(HEADER +
                  "A,A,48.80,-122.54,,2025-07-15T20:00:00Z,20,,\n"
                  "A,A,48.80,-122.54,,2025-07-15T20:00:00Z,22,,\n")
        _, obs, stats = read_stations_csv(p, BBOX)
        self.assertEqual([o["temp_c"] for o in obs], [22.0])
        self.assertEqual(stats["duplicates_collapsed"], 1)

    def test_column_mapping_and_missing_required_column(self):
        p = write("id,latitude,longitude,time,t_c\nS1,48.8,-122.5,2025-07-15T20:00:00Z,25\n")
        cols = {"station_id": "id", "lat": "latitude", "lon": "longitude",
                "timestamp": "time", "temp": "t_c"}
        stations, obs, _ = read_stations_csv(p, BBOX, columns=cols)
        self.assertEqual((stations[0]["name"], len(obs)), ("S1", 1))
        with self.assertRaises(ValueError):
            read_stations_csv(p, BBOX)  # default column names absent

    def test_rejects_unknown_units(self):
        with self.assertRaises(ValueError):
            read_stations_csv(write(HEADER), BBOX, temp_unit="x")


if __name__ == "__main__":
    unittest.main()
