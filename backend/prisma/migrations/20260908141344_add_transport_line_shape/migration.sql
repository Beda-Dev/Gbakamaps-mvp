-- AlterTable
ALTER TABLE "transport_lines" ADD COLUMN     "shapeGeoJson" JSONB,
ADD COLUMN     "shapeSource" TEXT;
