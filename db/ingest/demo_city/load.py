"""Load a generated demo city (data/<region>/) into PostGIS.

Idempotent: replaces that region's rows in a single transaction, so a failed
load never leaves a half-populated region behind.

Usage (from db/ingest):  .venv/bin/python -m demo_city.load [--data ../../data] [--region demo-city]
"""
import argparse
import json
import os
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

from .grid import REGION

REPO_ROOT = Path(__file__).resolve().parents[3]


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    env_file = REPO_ROOT / ".env"
    if not url and env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    if not url:
        raise SystemExit("DATABASE_URL must be set (see .env.example)")
    return url


def load(conn, vec_dir: Path, region: str) -> dict[str, int]:
    manifest = json.loads((vec_dir / "manifest.json").read_text())
    landcover = json.loads((vec_dir / "landcover.geojson").read_text())["features"]
    st = json.loads((vec_dir / "stations.json").read_text())
    w, s, e, n = manifest["bbox"]

    with conn, conn.cursor() as cur:
        # Observations cascade from stations.
        cur.execute("DELETE FROM weather_stations WHERE region = %s", (region,))
        cur.execute("DELETE FROM land_cover WHERE region = %s", (region,))
        cur.execute("DELETE FROM raster_layers WHERE region = %s", (region,))

        execute_values(cur, """
            INSERT INTO land_cover (region, class, canopy_pct, impervious_pct, area_m2, geom)
            SELECT v.region, v.class, v.canopy, v.imp,
                   ST_Area(g.geom::geography),
                   g.geom
            FROM (VALUES %s) AS v(region, class, canopy, imp, gj)
            CROSS JOIN LATERAL (
              SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(v.gj), 4326)) AS geom) g
        """, [(region, f["properties"]["class"], f["properties"]["canopy_pct"],
               f["properties"]["impervious_pct"], json.dumps(f["geometry"]))
              for f in landcover])

        for x in st["stations"]:
            cur.execute("""
                INSERT INTO weather_stations (station_id, name, region, elevation_m, source, geom)
                VALUES (%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))""",
                (x["station_id"], x["name"], region, x.get("elevation_m"),
                 x.get("source", "synthetic"), x["lon"], x["lat"]))

        obs_rows = [(o["station_id"], o["observed_at"], o["temp_c"], o["humidity_pct"], o["wind_ms"])
                    for o in st["observations"]]
        if obs_rows:
            execute_values(cur, """
            INSERT INTO station_observations
              (station_id, observed_at, temp_c, humidity_pct, wind_ms) VALUES %s""", obs_rows)

        for r in manifest["rasters"]:
            cur.execute("""
                INSERT INTO raster_layers
                  (name, region, kind, path, epsg, width_px, height_px, nodata, unit,
                   description, bbox)
                VALUES (%s, %s, %s, %s, 4326, %s, %s, %s, %s, %s,
                        ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                ON CONFLICT (name) DO UPDATE SET
                  region = EXCLUDED.region, kind = EXCLUDED.kind, path = EXCLUDED.path,
                  width_px = EXCLUDED.width_px, height_px = EXCLUDED.height_px,
                  nodata = EXCLUDED.nodata, unit = EXCLUDED.unit,
                  description = EXCLUDED.description, bbox = EXCLUDED.bbox""",
                (r["name"], region, r["kind"], r["path"], r["width_px"], r["height_px"],
                 r["nodata"], r["unit"], r["description"], w, s, e, n))

    return {"land_cover": len(landcover), "weather_stations": len(st["stations"]),
            "station_observations": len(st["observations"]), "raster_layers": len(manifest["rasters"])}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=REPO_ROOT / "data")
    ap.add_argument("--region", default=REGION)
    args = ap.parse_args(argv)

    conn = psycopg2.connect(database_url())
    try:
        counts = load(conn, args.data / args.region, args.region)
    finally:
        conn.close()
    for table, n in counts.items():
        print(f"{table}: {n}")


if __name__ == "__main__":
    main()
