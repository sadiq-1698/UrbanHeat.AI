"""Land cover polygons and weather stations derived from the synthetic fields."""
from datetime import datetime, timedelta, timezone

import numpy as np
from rasterio.features import rasterize, shapes, sieve
from shapely.geometry import MultiPolygon, Point, mapping, shape

from .grid import Grid

CLASS_IDS = {
    "water": 1, "developed_high": 2, "developed_medium": 3, "developed_low": 4,
    "developed_open": 5, "forest": 6, "shrub_grass": 7, "cropland": 8, "barren": 9,
}
ID_TO_CLASS = {v: k for k, v in CLASS_IDS.items()}
MIN_POLYGON_PX = 25  # sieve threshold: merges specks into their neighbours


def classify(f: dict[str, np.ndarray]) -> np.ndarray:
    imp, can, elev = f["impervious"], f["canopy"], f["elevation"]
    c = np.full(imp.shape, CLASS_IDS["barren"], dtype=np.uint8)
    c[(can < 30) & (elev < 50)] = CLASS_IDS["cropland"]
    c[(can >= 30) & (can < 60)] = CLASS_IDS["shrub_grass"]
    c[can >= 60] = CLASS_IDS["forest"]
    c[imp >= 8] = CLASS_IDS["developed_open"]
    c[imp >= 20] = CLASS_IDS["developed_low"]
    c[imp >= 50] = CLASS_IDS["developed_medium"]
    c[imp >= 80] = CLASS_IDS["developed_high"]
    c[f["water"]] = CLASS_IDS["water"]
    return c


def landcover_features(f: dict[str, np.ndarray], grid: Grid) -> list[dict]:
    """GeoJSON features (MultiPolygon) with class and zonal-mean canopy/impervious."""
    classes = sieve(classify(f), MIN_POLYGON_PX, connectivity=4)
    features = []
    for geom, cid in shapes(classes, mask=None, transform=grid.transform, connectivity=4):
        poly = shape(geom)
        inside = rasterize([(geom, 1)], out_shape=classes.shape, transform=grid.transform,
                           fill=0, dtype="uint8").astype(bool)
        if not inside.any():
            continue
        features.append({
            "type": "Feature",
            "geometry": mapping(MultiPolygon([poly])),
            "properties": {
                "class": ID_TO_CLASS[int(cid)],
                "canopy_pct": round(float(f["canopy"][inside].mean()), 2),
                "impervious_pct": round(float(f["impervious"][inside].mean()), 2),
            },
        })
    return features


def make_stations(f: dict[str, np.ndarray], grid: Grid, n: int = 24, seed: int = 42,
                  min_sep_deg: float = 0.018) -> list[dict]:
    """Random land stations with a minimum separation; LST sampled at each site."""
    rng = np.random.default_rng(seed + 1)
    pts: list[tuple[float, float]] = []
    attempts = 0
    while len(pts) < n and attempts < 20000:
        attempts += 1
        lon = rng.uniform(grid.west + 0.01, grid.east - 0.01)
        lat = rng.uniform(grid.south + 0.01, grid.north - 0.01)
        r, c = grid.xy_to_rowcol(lon, lat)
        if f["water"][r, c]:
            continue
        if any((lon - x) ** 2 + (lat - y) ** 2 < min_sep_deg**2 for x, y in pts):
            continue
        pts.append((lon, lat))
    stations = []
    for i, (lon, lat) in enumerate(pts, start=1):
        r, c = grid.xy_to_rowcol(lon, lat)
        stations.append({
            "station_id": f"DEMO{i:02d}", "name": f"Demo Station {i:02d}",
            "lon": round(lon, 6), "lat": round(lat, 6),
            "elevation_m": round(float(f["elevation"][r, c]), 1),
            "lst_c": float(f["lst"][r, c]),
        })
    return stations


def make_observations(stations: list[dict], seed: int = 42,
                      day: str = "2025-07-15") -> list[dict]:
    """24 hourly air-temperature readings per station (UTC timestamps).

    Air temperature blends a regional diurnal cycle (peaking ~15:00 local, UTC-7)
    with the station's local land-surface temperature, so hot surfaces read warmer.
    """
    rng = np.random.default_rng(seed + 2)
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    obs = []
    for s in stations:
        offset = 0.12 * (s["lst_c"] - 28.0) * 5  # local surface anomaly, damped
        for h in range(24):
            local_hour = (h - 7) % 24
            regional = 22.0 + 7.0 * np.sin(2 * np.pi * (local_hour - 9) / 24)
            temp = regional + offset * (0.4 + 0.6 * max(0.0, np.sin(np.pi * (local_hour - 6) / 14))
                                        if 6 <= local_hour <= 20 else 0.4) + rng.normal(0, 0.3)
            obs.append({
                "station_id": s["station_id"],
                "observed_at": (start + timedelta(hours=h)).isoformat(),
                "temp_c": round(float(temp), 2),
                "humidity_pct": round(float(np.clip(95 - 2.6 * temp + rng.normal(0, 3), 15, 100)), 1),
                "wind_ms": round(float(abs(rng.normal(2.5, 1.0))), 1),
            })
    return obs
