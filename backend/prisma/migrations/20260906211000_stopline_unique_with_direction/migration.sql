-- DropIndex
DROP INDEX "stop_lines_stopId_lineId_key";

-- CreateIndex
CREATE UNIQUE INDEX "stop_lines_stopId_lineId_direction_key" ON "stop_lines"("stopId", "lineId", "direction");
