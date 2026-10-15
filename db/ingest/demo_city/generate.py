"""Generate the synthetic demo city into data/ (rasters + vectors + manifest).

Usage (from db/ingest):  .venv/bin/python -m demo_city.generate [--out ../../data] [--seed 42]
"""
import argparse
import json
from pathlib import Path

from .fields import synthesize
from .grid import REGION, Grid
from .rasters import LAYERS, NODATA, write_geotiff
from .vectors import landcover_features, make_observations, make_stations


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[3] / "data")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args(argv)

    grid = Grid()
    f = synthesize(grid, seed=args.seed)
    raster_dir = args.out / "rasters"
    vec_dir = args.out / REGION
    vec_dir.mkdir(parents=True, exist_ok=True)

    layers = []
    for kind, (key, unit, desc) in LAYERS.items():
        name = f"{REGION}-{kind}"
        rel = f"{name}.tif"
        write_geotiff(raster_dir / rel, f[key], grid)
        layers.append({"name": name, "kind": kind, "path": rel, "unit": unit,
                       "description": desc, "width_px": grid.width,
                       "height_px": grid.height, "nodata": NODATA})
        print(f"wrote {raster_dir / rel}")

    features = landcover_features(f, grid)
    (vec_dir / "landcover.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}))
    stations = make_stations(f, grid, seed=args.seed)
    observations = make_observations(stations, seed=args.seed)
    (vec_dir / "stations.json").write_text(json.dumps(
        {"stations": [{k: v for k, v in s.items() if k != "lst_c"} for s in stations],
         "observations": observations}))
    (vec_dir / "manifest.json").write_text(json.dumps({
        "region": REGION, "seed": args.seed,
        "bbox": [grid.west, grid.south, grid.east, grid.north], "rasters": layers}, indent=2))
    print(f"{len(features)} land cover polygons, {len(stations)} stations, "
          f"{len(observations)} observations -> {vec_dir}")


if __name__ == "__main__":
    main()
