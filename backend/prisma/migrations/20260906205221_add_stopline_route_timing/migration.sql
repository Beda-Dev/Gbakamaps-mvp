-- DropIndex
DROP INDEX "stops_geog_idx";

-- AlterTable
ALTER TABLE "stop_lines" ADD COLUMN     "secondsFromRouteStart" INTEGER;

-- CreateIndex
CREATE INDEX "stop_lines_lineId_direction_sequence_idx" ON "stop_lines"("lineId", "direction", "sequence");
