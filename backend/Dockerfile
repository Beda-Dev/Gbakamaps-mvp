# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./dist/generated
COPY package.json ./
COPY prisma ./prisma
# Nécessaire pour `node dist/scripts/import-gtfs.js` en production — ce
# script lit des fichiers CSV locaux (contrairement à import-line-shapes.js
# et import-sotra-stops.js, qui interrogent data.gouv.ci en direct et n'en
# ont pas besoin). Sans cette ligne, l'import GTFS échouait silencieusement
# "fichier introuvable" dans le conteneur de production (jamais testé avant
# le 2026-09-08 — trouvé en vérifiant concrètement, pas supposé).
COPY data ./data

EXPOSE 4000
CMD ["node", "dist/server.js"]
