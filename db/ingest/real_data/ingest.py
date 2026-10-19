"""Ingest real data for a region into data/<region>/ (same layout as demo_city.generate).

Run the loader afterwards:  python -m demo_city.load --region <region>

Usage (from db/ingest):
  .venv/bin/python -m real_data.ingest --region bellingham-wa \\
      --bbox -122.56 48.69 -122.40 48.80 \\
      --nlcd-landcover NLCD_2021_Land_Cover.tif --nlcd-canopy nlcd_tcc_2021.tif \\
      --nlcd-impervious NLCD_2021_Impervious.tif --lst landsat_ST_B10.tif \\
      [--lst-units landsat-c2|celsius|kelvin] [--dem dem.tif] [--stations-csv obs.csv ...]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from rasterio.enums import Resampling

from demo_city.grid import Grid
from demo_city.rasters import LAYERS, NODATA, write_geotiff
from demo_city.vectors import landcover_features
from real_data.rasters import clip_to_grid, landsat_c2_st_to_celsius, nlcd_class_ids
from real_data.stations import read_stations_csv

REPO_ROOT = Path(__file__).resolve().parents[3]
MAX_UNMAPPED = 0.05  # abort if >5% of NLCD cells are outside the legend


def build_lst(path: Path, grid: Grid, units: str, resampling: Resampling) -> np.ndarray:
    if units == "landsat-c2":
        return landsat_c2_st_to_celsius(clip_to_grid(path, grid, valid_range=(1, 65535), resampling=resampling))
    if units == "kelvin":
        return clip_to_grid(path, grid, valid_range=(200, 350), resampling=resampling) - np.float32(273.15)
    return clip_to_grid(path, grid, valid_range=(-60, 60), resampling=resampling)


def ingest(args) -> dict:
    grid = Grid.from_bbox(*args.bbox, args.res)
    resampling = Resampling[args.resampling]
    out_vec = args.out / args.region
    out_vec.mkdir(parents=True, exist_ok=True)

    canopy = clip_to_grid(args.nlcd_canopy, grid, valid_range=(0, 100), resampling=resampling)
    impervious = clip_to_grid(args.nlcd_impervious, grid, valid_range=(0, 100), resampling=resampling)
    lst = build_lst(args.lst, grid, args.lst_units, resampling)
    layers_data = {"canopy": canopy, "impervious": impervious, "lst": lst}
    if args.dem:
        layers_data["elevation"] = clip_to_grid(args.dem, grid, resampling=resampling)

    codes = clip_to_grid(args.nlcd_landcover, grid, resampling=Resampling.nearest)
    class_ids, unmapped = nlcd_class_ids(codes)
    if unmapped > MAX_UNMAPPED:
        raise SystemExit(f"{unmapped:.1%} of land cover cells are outside the NLCD legend "
                         f"(or no-data); check the bbox against the raster's coverage")

    layers = []
    for kind, data in layers_data.items():
        _, unit, desc = LAYERS[kind]
        name = f"{args.region}-{kind}"
        write_geotiff(args.out / "rasters" / f"{name}.tif", data, grid)
        layers.append({"name": name, "kind": kind, "path": f"{name}.tif", "unit": unit,
                       "description": f"{desc.replace(' (synthetic)', '')} — real data",
                       "width_px": grid.width, "height_px": grid.height, "nodata": NODATA})

    features = landcover_features({"canopy": canopy, "impervious": impervious}, grid, classes=class_ids)
    (out_vec / "landcover.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}))

    stations, observations, station_stats = [], [], {}
    for csv_path in args.stations_csv:
        s, o, st = read_stations_csv(csv_path, tuple(args.bbox), source=args.station_source,
                                     temp_unit=args.temp_unit, wind_unit=args.wind_unit)
        stations += s
        observations += o
        station_stats[csv_path.name] = st
    (out_vec / "stations.json").write_text(json.dumps(
        {"stations": stations, "observations": observations}))
    (out_vec / "manifest.json").write_text(json.dumps({
        "region": args.region, "bbox": [grid.west, grid.south, grid.east, grid.north],
        "rasters": layers}, indent=2))

    summary = {"grid": f"{grid.width}x{grid.height}", "land_cover_polygons": len(features),
               "unmapped_landcover": round(unmapped, 4), "stations": len(stations),
               "observations": len(observations), "station_csv_stats": station_stats,
               "nodata_fraction": {k: round(float(np.isnan(v).mean()), 4) for k, v in layers_data.items()}}
    return summary


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", required=True)
    ap.add_argument("--bbox", type=float, nargs=4, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--res", type=float, default=0.0003, help="grid cell size in degrees (default 0.0003 ≈ 33 m)")
    ap.add_argument("--resampling", choices=["bilinear", "average", "nearest"], default="bilinear")
    ap.add_argument("--nlcd-landcover", type=Path, required=True)
    ap.add_argument("--nlcd-canopy", type=Path, required=True)
    ap.add_argument("--nlcd-impervious", type=Path, required=True)
    ap.add_argument("--lst", type=Path, required=True)
    ap.add_argument("--lst-units", choices=["landsat-c2", "celsius", "kelvin"], default="landsat-c2")
    ap.add_argument("--dem", type=Path, help="optional elevation raster (meters)")
    ap.add_argument("--stations-csv", type=Path, nargs="*", default=[])
    ap.add_argument("--station-source", default="csv")
    ap.add_argument("--temp-unit", choices=["c", "f", "k"], default="c")
    ap.add_argument("--wind-unit", choices=["ms", "kt", "mph"], default="ms")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data")
    return ap.parse_args(argv)


def main(argv=None) -> None:
    summary = ingest(parse_args(argv))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
