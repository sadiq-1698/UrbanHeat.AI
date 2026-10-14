-- Land cover polygons with per-polygon canopy and impervious-surface coverage.
-- `region` is a free-text label (not a foreign key) so ingesting a new city
-- needs no schema change. canopy_pct / impervious_pct are 0–100 area shares
-- (zonal means of the source rasters, or synthetic values for the demo city).
CREATE TABLE IF NOT EXISTS land_cover (
    id             BIGSERIAL PRIMARY KEY,
    region         TEXT NOT NULL,
    class          TEXT NOT NULL CHECK (class IN (
                     'developed_high', 'developed_medium', 'developed_low',
                     'developed_open', 'forest', 'shrub_grass', 'cropland',
                     'wetland', 'water', 'barren')),
    canopy_pct     NUMERIC(5,2) NOT NULL CHECK (canopy_pct BETWEEN 0 AND 100),
    impervious_pct NUMERIC(5,2) NOT NULL CHECK (impervious_pct BETWEEN 0 AND 100),
    area_m2        DOUBLE PRECISION,           -- computed at ingest (geography area)
    import_batch   TIMESTAMPTZ NOT NULL DEFAULT now(),
    geom           GEOMETRY(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS land_cover_geom_gix ON land_cover USING GIST (geom);
CREATE INDEX IF NOT EXISTS land_cover_region_class_ix ON land_cover (region, class);
