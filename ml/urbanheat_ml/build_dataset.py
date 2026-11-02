"""Build the per-cell training dataset for a region.

Usage (from ml/):  .venv/bin/python -m urbanheat_ml.build_dataset --region demo-city [--data ../data] [--out ../data/ml]
Reads  data/rasters/<region>-{canopy,impervious,elevation,lst}.tif  and  data/<region>/landcover.geojson
Writes data/ml/<region>/dataset.csv.gz  and  dataset.meta.json
"""
import argparse
import json
from pathlib import Path

from .dataset import build_dataset, write_dataset

REPO_ROOT = Path(__file__).resolve().parents[2]


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default="demo-city")
    ap.add_argument("--data", type=Path, default=REPO_ROOT / "data")
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "ml")
    ap.add_argument("--block-m", type=float, default=2000.0, help="spatial block size for cross-validation, metres")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--include-water", action="store_true", help="keep open-water cells (default: excluded; their physics differs)")
    args = ap.parse_args(argv)

    df, meta = build_dataset(args.region, args.data, block_m=args.block_m, folds=args.folds, seed=args.seed, include_water=args.include_water)
    csv, mp = write_dataset(df, meta, args.out / args.region)
    print(json.dumps({k: meta[k] for k in ("rows", "cells", "baseline_lst_c", "baseline", "spatial_cv")}, indent=2))
    print(f"wrote {csv} ({csv.stat().st_size / 1e6:.1f} MB) and {mp}")


if __name__ == "__main__":
    main()
