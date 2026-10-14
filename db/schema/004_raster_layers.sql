-- Catalog of GeoTIFFs on disk. Pixel data stays in files (read on the fly by
-- geotiff.js); this table tells the API which file backs which layer and how
-- to interpret it, and lets PostGIS answer "which rasters cover this point?".
CREATE TABLE IF NOT EXISTS raster_layers (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,            -- e.g. 'demo-canopy'
    region       TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN (
                   'canopy', 'impervious', 'lst', 'elevation', 'other')),
    path         TEXT NOT NULL,                   -- relative to RASTER_DIR
    epsg         INTEGER NOT NULL DEFAULT 4326,
    width_px     INTEGER NOT NULL CHECK (width_px > 0),
    height_px    INTEGER NOT NULL CHECK (height_px > 0),
    nodata       DOUBLE PRECISION,
    unit         TEXT NOT NULL,                   -- 'percent', 'celsius', 'meters'
    captured_at  TIMESTAMPTZ,
    description  TEXT,
    bbox         GEOMETRY(Polygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS raster_layers_bbox_gix ON raster_layers USING GIST (bbox);
CREATE INDEX IF NOT EXISTS raster_layers_region_kind_ix ON raster_layers (region, kind);
