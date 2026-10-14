#!/bin/bash
# Creates the read-only role the Next.js API routes connect as (APP_DATABASE_URL).
#
# This is a .sh file rather than plain SQL because the password comes from the
# APP_RO_PASSWORD environment variable (set in docker-compose.yml from .env):
# docker-entrypoint-initdb.d feeds .sql files to psql verbatim with no variable
# substitution, but runs .sh files with the container's environment.
set -euo pipefail

: "${APP_RO_PASSWORD:?APP_RO_PASSWORD must be set}"

# Inside docker-entrypoint-initdb.d, POSTGRES_USER/POSTGRES_DB are set and psql
# connects over the local socket. When db/migrate.sh runs this directly against
# an already-provisioned DB, DATABASE_URL is set instead — prefer it if present.
if [ -n "${DATABASE_URL:-}" ]; then
  PSQL_ARGS=("$DATABASE_URL")
  ADMIN_ROLE="${POSTGRES_USER:-urbanheat_admin}"
  DB_NAME="${POSTGRES_DB:-urbanheat}"
else
  PSQL_ARGS=(--username "$POSTGRES_USER" --dbname "$POSTGRES_DB")
  ADMIN_ROLE="$POSTGRES_USER"
  DB_NAME="$POSTGRES_DB"
fi

psql -v ON_ERROR_STOP=1 "${PSQL_ARGS[@]}" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'urbanheat_ro') THEN
        CREATE ROLE urbanheat_ro LOGIN PASSWORD '${APP_RO_PASSWORD}';
      END IF;
    END
    \$\$;

    GRANT CONNECT ON DATABASE ${DB_NAME} TO urbanheat_ro;
    GRANT USAGE ON SCHEMA public TO urbanheat_ro;
    GRANT SELECT ON land_cover, weather_stations, station_observations, raster_layers
      TO urbanheat_ro;

    -- No INSERT/UPDATE/DELETE/TRUNCATE grants, ever, for this role. Tables
    -- created later by the admin role are auto-readable, so future migrations
    -- need no manual grant line.
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ADMIN_ROLE} IN SCHEMA public
      GRANT SELECT ON TABLES TO urbanheat_ro;

    -- Belt-and-suspenders: a runaway or mutating query from the API can't
    -- succeed even if application-level validation has a bug.
    ALTER ROLE urbanheat_ro SET statement_timeout = '10s';
    ALTER ROLE urbanheat_ro SET default_transaction_read_only = on;
EOSQL
