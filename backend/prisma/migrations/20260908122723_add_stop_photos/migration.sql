-- CreateTable
CREATE TABLE "stop_photos" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stop_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stop_photos_stopId_idx" ON "stop_photos"("stopId");

-- AddForeignKey
ALTER TABLE "stop_photos" ADD CONSTRAINT "stop_photos_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_photos" ADD CONSTRAINT "stop_photos_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
