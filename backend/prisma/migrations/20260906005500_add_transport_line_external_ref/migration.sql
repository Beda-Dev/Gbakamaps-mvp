-- AlterTable
ALTER TABLE "transport_lines" ADD COLUMN "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "transport_lines_externalRef_key" ON "transport_lines"("externalRef");
