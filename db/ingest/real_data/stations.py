"""Read a long-format station CSV (one row per observation) into the loader's format.

Expected columns (names overridable via `columns`): station_id, lat, lon, timestamp,
temp; optional: name, elevation_m, humidity_pct, wind. Works for NOAA ISD/GHCNh
exports once you rename or map the columns.
"""
import csv
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

DEFAULT_COLUMNS = {
    "station_id": "station_id", "name": "name", "lat": "lat", "lon": "lon",
    "elevation_m": "elevation_m", "timestamp": "timestamp", "temp": "temp",
    "humidity_pct": "humidity_pct", "wind": "wind",
}
TEMP_TO_C = {"c": lambda v: v, "f": lambda v: (v - 32) * 5 / 9, "k": lambda v: v - 273.15}
WIND_TO_MS = {"ms": 1.0, "kt": 0.514444, "mph": 0.44704}


def _num(row: dict, col: str | None) -> float | None:
    if not col or row.get(col) in (None, ""):
        return None
    try:
        v = float(row[col])
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _timestamp(raw: str) -> str | None:
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()


def read_stations_csv(path: Path, bbox: tuple[float, float, float, float], *,
                      columns: dict[str, str] | None = None, temp_unit: str = "c",
                      wind_unit: str = "ms", source: str = "csv"):
    """Returns (stations, observations, stats). Naive timestamps are taken as UTC.

    Rows are skipped (and counted in stats) when coordinates/timestamp/temperature
    are missing, the station lies outside `bbox`, or the temperature is not
    physically plausible (outside -60..60 °C after conversion).
    """
    if temp_unit not in TEMP_TO_C or wind_unit not in WIND_TO_MS:
        raise ValueError(f"temp_unit must be one of {sorted(TEMP_TO_C)}, wind_unit one of {sorted(WIND_TO_MS)}")
    col = {**DEFAULT_COLUMNS, **(columns or {})}
    west, south, east, north = bbox

    meta: dict[str, dict] = defaultdict(lambda: {"lats": [], "lons": [], "elev": [], "name": None})
    obs: dict[tuple[str, str], dict] = {}
    stats = defaultdict(int)

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        missing = [col[k] for k in ("station_id", "lat", "lon", "timestamp", "temp")
                   if col[k] not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path}: missing required column(s) {missing}; found {reader.fieldnames}")
        for row in reader:
            stats["rows"] += 1
            sid = (row.get(col["station_id"]) or "").strip()
            lat, lon = _num(row, col["lat"]), _num(row, col["lon"])
            temp = _num(row, col["temp"])
            ts = _timestamp(row.get(col["timestamp"]) or "")
            if not sid or lat is None or lon is None or temp is None or ts is None:
                stats["skipped_incomplete"] += 1
                continue
            if not (west <= lon <= east and south <= lat <= north):
                stats["skipped_outside_bbox"] += 1
                continue
            temp_c = TEMP_TO_C[temp_unit](temp)
            if not -60 <= temp_c <= 60:
                stats["skipped_implausible_temp"] += 1
                continue
            m = meta[sid]
            m["lats"].append(lat)
            m["lons"].append(lon)
            if (e := _num(row, col["elevation_m"])) is not None:
                m["elev"].append(e)
            m["name"] = m["name"] or (row.get(col["name"]) or "").strip() or None
            hum = _num(row, col["humidity_pct"])
            wind = _num(row, col["wind"])
            # Duplicate (station, timestamp): keep the last, matching the table's PK.
            obs[(sid, ts)] = {
                "station_id": sid, "observed_at": ts, "temp_c": round(temp_c, 2),
                "humidity_pct": round(min(max(hum, 0), 100), 1) if hum is not None else None,
                "wind_ms": round(abs(wind) * WIND_TO_MS[wind_unit], 1) if wind is not None else None,
            }
    stats["duplicates_collapsed"] = stats["rows"] - sum(
        stats[k] for k in ("skipped_incomplete", "skipped_outside_bbox", "skipped_implausible_temp")) - len(obs)

    stations = [{
        "station_id": sid, "name": m["name"] or sid,
        "lon": round(median(m["lons"]), 6), "lat": round(median(m["lats"]), 6),
        "elevation_m": round(median(m["elev"]), 1) if m["elev"] else None,
        "source": source,
    } for sid, m in sorted(meta.items())]
    return stations, sorted(obs.values(), key=lambda o: (o["station_id"], o["observed_at"])), dict(stats)
