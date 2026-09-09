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

# Exécution en non-root (image node:22-alpine officielle : l'utilisateur
# `node`, uid 1000, existe déjà — rien à créer). Trouvé en auditant le
# projet le 2026-09-09 : rien ne définissait `USER`, donc le process
# tournait en root par défaut. `su-exec` (léger, alpine) permet à
# docker-entrypoint.sh de démarrer en root (nécessaire pour `chown` le
# volume `backend_uploads` — voir ce fichier pour le pourquoi précis, un
# passage direct à `USER node` ici a réellement cassé l'upload de photos
# sur le volume de dev existant, EACCES reproduit avant ce correctif) puis
# de lancer le process réel en tant que `node`, jamais en root.
RUN apk add --no-cache su-exec && mkdir -p /app/uploads/stop-photos
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
# Un endpoint /api/health réel existe déjà (vérifie la DB, pas juste "le
# process tourne") mais rien ne l'appelait jamais côté Docker — trouvé en
# auditant le projet le 2026-09-09 : `docker compose ps`/`depends_on` ne
# pouvait donc jamais détecter un backend bloqué (event loop gelé, DB
# injoignable) tant que le process lui-même restait vivant. `wget` (pas
# `curl`, absent de node:22-alpine — vérifié) est déjà présent dans l'image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
