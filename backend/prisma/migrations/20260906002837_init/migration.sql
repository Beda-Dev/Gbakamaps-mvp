-- Extension requise pour les colonnes géographiques (utilisée à partir de
-- la migration add_postgis_geography). Déclarée ici, dans la toute première
-- migration, car la "shadow database" de Prisma rejoue l'historique complet
-- depuis zéro et doit donc trouver l'extension dès le début.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "StopSource" AS ENUM ('OSM', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "StopType" AS ENUM ('BUS_STOP', 'GBAKA_STOP', 'WORO_WORO_STOP', 'TAXI_STAND', 'MOTO_TAXI_STAND', 'PLATFORM', 'STATION');

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('BUS', 'GBAKA', 'WORO_WORO', 'TAXI', 'MOTO_TAXI');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('MISSING_STOP', 'INCORRECT_INFO', 'DAMAGE', 'SAFETY_ISSUE', 'NEW_LINE', 'SCHEDULE_CHANGE', 'DUPLICATE_STOP', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "stopType" "StopType" NOT NULL DEFAULT 'BUS_STOP',
    "source" "StopSource" NOT NULL DEFAULT 'COMMUNITY',
    "osmId" BIGINT,
    "shelter" BOOLEAN DEFAULT false,
    "bench" BOOLEAN DEFAULT false,
    "wheelchair" BOOLEAN DEFAULT false,
    "gbaka" BOOLEAN DEFAULT false,
    "woroworo" BOOLEAN DEFAULT false,
    "taxi" BOOLEAN DEFAULT false,
    "mototaxi" BOOLEAN DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_lines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "color" TEXT DEFAULT '#0A9396',
    "transportType" "TransportType" NOT NULL,
    "operator" TEXT,
    "fare" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stop_lines" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sequence" INTEGER,
    "direction" TEXT,

    CONSTRAINT "stop_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stopId" TEXT,
    "reportType" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "stops_osmId_key" ON "stops"("osmId");

-- CreateIndex
CREATE INDEX "stops_lat_lon_idx" ON "stops"("lat", "lon");

-- CreateIndex
CREATE UNIQUE INDEX "stop_lines_stopId_lineId_key" ON "stop_lines"("stopId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_userId_stopId_key" ON "favorites"("userId", "stopId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_createdAt_idx" ON "reports"("createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_lines" ADD CONSTRAINT "stop_lines_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stop_lines" ADD CONSTRAINT "stop_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transport_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
