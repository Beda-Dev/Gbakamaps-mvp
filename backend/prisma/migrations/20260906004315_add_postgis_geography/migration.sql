-- AlterTable
ALTER TABLE "stops" ADD COLUMN     "geog" geography(Point, 4326);

-- Backfill des lignes existantes à partir de lat/lon
UPDATE "stops" SET "geog" = ST_SetSRID(ST_MakePoint("lon", "lat"), 4326)::geography;

-- Trigger : garde "geog" synchronisée avec lat/lon à chaque insert/update,
-- pour que le code applicatif n'ait jamais à gérer les deux représentations.
CREATE OR REPLACE FUNCTION stops_sync_geog() RETURNS trigger AS $$
BEGIN
  NEW."geog" := ST_SetSRID(ST_MakePoint(NEW."lon", NEW."lat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stops_sync_geog_trigger
BEFORE INSERT OR UPDATE OF "lat", "lon" ON "stops"
FOR EACH ROW EXECUTE FUNCTION stops_sync_geog();

-- Index spatial GiST : indispensable pour que ST_DWithin soit performant
-- (corrige la limite identifiée à l'audit : recherche par bounding box +
-- Haversine en JS, non indexée, dans l'ancien projet).
CREATE INDEX "stops_geog_idx" ON "stops" USING GIST ("geog");
