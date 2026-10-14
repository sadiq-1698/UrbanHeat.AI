-- Weather station locations plus their temperature observations. Kept as two
-- tables so interpolation can pick a single timestamp (or an aggregate) without
-- duplicating station geometry per reading.
CREATE TABLE IF NOT EXISTS weather_stations (
    station_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    region       TEXT NOT NULL,
    elevation_m  REAL,
    source       TEXT NOT NULL DEFAULT 'synthetic',  -- e.g. 'synthetic', 'noaa-isd'
    geom         GEOMETRY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS weather_stations_geom_gix ON weather_stations USING GIST (geom);
CREATE INDEX IF NOT EXISTS weather_stations_region_ix ON weather_stations (region);

CREATE TABLE IF NOT EXISTS station_observations (
    station_id   TEXT NOT NULL REFERENCES weather_stations (station_id) ON DELETE CASCADE,
    observed_at  TIMESTAMPTZ NOT NULL,
    temp_c       REAL NOT NULL,
    humidity_pct REAL CHECK (humidity_pct BETWEEN 0 AND 100),
    wind_ms      REAL CHECK (wind_ms >= 0),
    PRIMARY KEY (station_id, observed_at)
);

-- Interpolation reads "all stations at time T", which the PK can't serve.
CREATE INDEX IF NOT EXISTS station_obs_time_ix ON station_observations (observed_at);
