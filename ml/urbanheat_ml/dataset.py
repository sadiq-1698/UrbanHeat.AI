"""Assemble the per-cell training table for a region (see build_dataset.py for the CLI)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from shapely.geometry import shape

from .features import FEATURE_NAMES, RADII_M, DIST_CAP_M, CellSize, build_features, cell_size_m

KINDS = ("canopy", "impervious", "elevation", "lst")
# A cell is "reference" (the cool baseline a heat spike is measured against) if it is well vegetated and barely paved.
REFERENCE_CANOPY_MIN = 60.0
REFERENCE_IMPERVIOUS_MAX = 5.0
MIN_REFERENCE_CELLS = 30


def read_layers(region: str, data_dir: Path) -> tuple[dict[str, np.ndarray], rasterio.Affine, tuple[int, int]]:
    """Read the region's four rasters (NaN for no-data); they must share one grid."""
    layers: dict[str, np.ndarray] = {}
    ref = None
    for kind in KINDS:
        path = data_dir / "rasters" / f"{region}-{kind}.tif"
        if not path.exists():
            raise FileNotFoundError(f"{path} not found; generate or ingest the region first (db/ingest)")
        with rasterio.open(path) as src:
            if src.crs is None or src.crs.to_epsg() != 4326:
                raise ValueError(f"{path}: expected EPSG:4326")
            if src.transform.b or src.transform.d or src.transform.e >= 0:
                raise ValueError(f"{path}: expected a north-up grid")
            a = src.read(1).astype("float64")
            if src.nodata is not None:
                a[a == src.nodata] = np.nan
            sig = (src.transform, src.shape)
            if ref is None:
                ref = sig
            elif not (np.allclose(tuple(sig[0])[:6], tuple(ref[0])[:6]) and sig[1] == ref[1]):
                raise ValueError(f"{path}: grid differs from the other layers; re-ingest them onto one grid")
            layers[kind] = a
    return layers, ref[0], ref[1]


def water_mask(region: str, data_dir: Path, transform, shape_hw: tuple[int, int]) -> np.ndarray:
    """Cells covered by `water` land cover polygons (cell-centre rule)."""
    path = data_dir / region / "landcover.geojson"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found")
    feats = json.loads(path.read_text())["features"]
    geoms = [shape(f["geometry"]) for f in feats if f["properties"].get("class") == "water"]
    if not geoms:
        return np.zeros(shape_hw, dtype=bool)
    return rasterize([(g, 1) for g in geoms], out_shape=shape_hw, transform=transform, fill=0, dtype="uint8").astype(bool)


def reference_baseline(lst: np.ndarray, canopy: np.ndarray, impervious: np.ndarray, land_valid: np.ndarray) -> tuple[float, dict]:
    """Median LST of well-vegetated, barely-paved land cells; falls back to the 10th percentile if there are too few."""
    ref = land_valid & (canopy >= REFERENCE_CANOPY_MIN) & (impervious <= REFERENCE_IMPERVIOUS_MAX)
    n = int(ref.sum())
    if n >= MIN_REFERENCE_CELLS:
        return float(np.median(lst[ref])), {"method": "median of reference cells", "reference_cells": n}
    return float(np.percentile(lst[land_valid], 10)), {"method": "10th percentile of land LST (too few reference cells)", "reference_cells": n}


def spatial_folds(block_ids: np.ndarray, n_folds: int, seed: int) -> np.ndarray:
    """Assign whole spatial blocks to folds: shuffle the unique blocks (seeded), deal them out round-robin."""
    uniq = np.unique(block_ids)
    order = np.random.default_rng(seed).permutation(len(uniq))
    fold_of = {int(uniq[i]): int(k % n_folds) for k, i in enumerate(order)}
    return np.array([fold_of[int(b)] for b in block_ids], dtype=np.int16)


def build_dataset(region: str, data_dir: Path, *, block_m: float = 2000.0, folds: int = 5, seed: int = 42, include_water: bool = False) -> tuple[pd.DataFrame, dict]:
    layers, transform, (h, w) = read_layers(region, data_dir)
    water = water_mask(region, data_dir, transform, (h, w))
    lat_center = transform.f + transform.e * h / 2
    size = cell_size_m(transform.a, -transform.e, lat_center)

    feats = build_features(layers["canopy"], layers["impervious"], layers["elevation"], water, size)
    lst = layers["lst"]
    complete = np.all([~np.isnan(v) for v in feats.values()], axis=0) & ~np.isnan(lst)
    keep = complete if include_water else (complete & ~water)
    land_valid = complete & ~water
    baseline, baseline_info = reference_baseline(lst, layers["canopy"], layers["impervious"], land_valid)

    rows, cols = np.nonzero(keep)
    lons = transform.c + (cols + 0.5) * transform.a
    lats = transform.f + (rows + 0.5) * transform.e
    block_ids = (np.floor(rows * size.dy_m / block_m).astype(np.int64) * 100_000 + np.floor(cols * size.dx_m / block_m).astype(np.int64))
    df = pd.DataFrame({"row": rows, "col": cols, "lon": lons.round(6), "lat": lats.round(6), "block_id": block_ids,
                       "fold": spatial_folds(block_ids, folds, seed)})
    for name in FEATURE_NAMES:
        df[name] = feats[name][keep].astype("float32")
    df["is_water"] = water[keep]
    df["lst_c"] = lst[keep].astype("float32")
    df["lst_anomaly_c"] = (lst[keep] - baseline).astype("float32")

    meta = {
        "region": region,
        "grid": {"width": w, "height": h, "res_lon": transform.a, "res_lat": -transform.e, "west": transform.c, "north": transform.f,
                 "cell_dx_m": size.dx_m, "cell_dy_m": size.dy_m, "lat_center": lat_center},
        "features": list(FEATURE_NAMES),
        "radii_m": list(RADII_M),
        "dist_cap_m": DIST_CAP_M,
        "target": "lst_anomaly_c",
        "baseline_lst_c": baseline,
        "baseline": baseline_info,
        "rows": int(len(df)),
        "cells": {"total": h * w, "water": int(water.sum()), "dropped_incomplete": int((~complete & ~water).sum()), "kept": int(keep.sum())},
        "spatial_cv": {"block_m": block_m, "folds": folds, "seed": seed, "blocks": int(np.unique(block_ids).size),
                       "rows_per_fold": {int(k): int(v) for k, v in df["fold"].value_counts().sort_index().items()}},
        "include_water": include_water,
    }
    return df, meta


def write_dataset(df: pd.DataFrame, meta: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv = out_dir / "dataset.csv.gz"
    df.to_csv(csv, index=False, compression="gzip", float_format="%.5g")
    mp = out_dir / "dataset.meta.json"
    mp.write_text(json.dumps(meta, indent=2))
    return csv, mp
