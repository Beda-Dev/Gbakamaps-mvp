# GbakaMap MVP

Reconstruction du projet GbakaMap (localisation des transports informels — bus, gbaka, woro-woro — en Côte d'Ivoire), sur une base plus simple, plus sûre et entièrement auto-hébergée. Ce dépôt remplace l'ancien backend Next.js/Firebase/Neon — voir [§ Pourquoi cette reconstruction](#pourquoi-cette-reconstruction).

> 📋 **[PROJECT_MEMORY.md](PROJECT_MEMORY.md)** tient à jour l'état détaillé du projet, les décisions techniques justifiées, les bugs déjà rencontrés (et comment ne pas les reproduire) et les prochaines étapes. À lire avant toute reprise de travail sur ce projet.

## État actuel

| Composant | État |
|---|---|
| Backend (Fastify + Prisma + PostgreSQL/PostGIS) | ✅ Fonctionnel — 6 modules, 52 tests réels |
| Frontend (PWA) | 🚧 Carte + auth fonctionnelles ; favoris/signalements/admin/itinéraire pas encore d'écran |
| Déploiement / CI | 🚧 Pas encore mis en place (volontairement, cf. principe MVP) |

## Stack

- **Backend** : Node.js + [Fastify](https://fastify.dev) + [Prisma](https://www.prisma.io) + TypeScript
- **Base de données** : PostgreSQL 16 + [PostGIS](https://postgis.net) (recherche géospatiale indexée), auto-hébergée via Docker
- **Authentification** : gérée nous-mêmes — sessions opaques en base (pas de JWT côté client), mots de passe hashés en argon2id. Pas de Firebase.
- **Frontend** : Vite + React + TypeScript, PWA (MapLibre/MapTiler, auth, favoris)
- **Données transport** : import batch depuis le flux GTFS [JungleBus — Grand Abidjan](backend/data/gtfs-abidjan/README.md) (3 820 arrêts réels, 391 lignes bus/gbaka/woro-woro)

## Prérequis

- Node.js 20+ et npm
- Docker + Docker Compose

## Démarrage rapide

```bash
# 1. Cloner et se placer à la racine du monorepo
cp .env.example .env
# éditer .env si besoin (les valeurs par défaut fonctionnent en local)

# 2. Démarrer la base de données (PostgreSQL + PostGIS)
docker compose up -d db

# 3. Installer les dépendances du backend
cd backend
npm install
cp ../.env.example .env
# éditer backend/.env : remplacer "db:5432" par "localhost:5433" dans
# DATABASE_URL (voir l'encart ci-dessous — deux .env différents, deux
# usages différents)

# 4. Appliquer les migrations
npx prisma migrate deploy

# 5. (Optionnel mais recommandé) Importer les données réelles GTFS Abidjan
npm run import:gtfs

# 6. Lancer le backend en développement
npm run dev
# → http://localhost:4000/api/health doit répondre {"success":true,...}
```

### ⚠️ Pourquoi deux fichiers `.env` ?

- **`.env` à la racine** alimente `docker-compose.yml`. `DATABASE_URL` y utilise le nom d'hôte interne au réseau Docker (`db`), car c'est le backend **conteneurisé** qui s'en sert.
- **`backend/.env`** alimente le process Node quand tu le lances directement sur ta machine (`npm run dev`, `npm test`, scripts Prisma) — il doit utiliser `localhost` + le **port exposé** (`5433` par défaut, pas `5432` — un PostgreSQL local préexistant sur ta machine peut déjà occuper 5432, cf. `.env.example`).

Les deux fichiers sont gitignorés. Ne jamais y mettre de vraies valeurs de production.

## Lancer le backend entièrement en Docker (comme en production)

```bash
docker compose up -d --build
curl http://localhost:4000/api/health
```

`docker compose down` arrête les conteneurs **sans perdre les données** (volume nommé `gbakamap_db_data`). Pour tout réinitialiser : `docker compose down -v`.

### ⚠️ Les imports de données ne sont PAS automatiques

Ni au build de l'image, ni au démarrage du conteneur : `CMD` ne lance que le
serveur HTTP (`dist/server.js`). C'est voulu — un import de données n'a pas
sa place sur le chemin de démarrage d'un serveur de requêtes (les mêmes
scripts servent aussi en local, hors Docker, où un démarrage silencieux qui
réimporterait 3 820 arrêts à chaque redémarrage serait surprenant). Sur un
**premier déploiement sur un serveur réel**, après `docker compose up -d --build`,
il faut lancer manuellement, une fois (idempotent, sans risque de doublon à
relancer) :

```bash
docker compose exec backend node dist/scripts/import-gtfs.js
docker compose exec backend node dist/scripts/import-line-shapes.js
docker compose exec backend node dist/scripts/import-sotra-stops.js
```

- `import-gtfs.js` lit les fichiers CSV embarqués dans l'image
  (`backend/data/gtfs-abidjan/`, voir son propre README) — arrêts et lignes
  de base.
- `import-line-shapes.js` et `import-sotra-stops.js` interrogent
  **data.gouv.ci en direct** (aucun fichier local requis) — tracés réels de
  lignes et comblement des arrêts SOTRA officiels manquants. Peuvent être
  relancés à tout moment pour rafraîchir ces deux jeux de données sans
  risque (upsert par ID exact, jamais de doublon).

Vérifié réellement le 2026-09-08 en reconstruisant l'image et en exécutant
les trois commandes ci-dessus contre un conteneur "à froid" — voir
`PROJECT_MEMORY.md` §12.19/§12.20 pour le détail (le `Dockerfile` ne
copiait pas `data/` avant cette date, ce qui aurait fait échouer
`import-gtfs.js` en production).

## Tests

```bash
cd backend
docker compose -f ../docker-compose.yml up -d db   # si pas déjà démarré
npx vitest run
```

Tous les tests tournent contre une **vraie base PostgreSQL/PostGIS** (aucun mock de la base). Les seuls mocks du projet concernent un service tiers (OpenRouteService) pour simuler des pannes réseau de façon déterministe — voir `backend/tests/routing.test.ts`.

**État actuel : 52 tests backend, tous verts (+ 6 tests frontend).**

### Tests end-to-end (Playwright, `frontend/e2e/`)

Le parcours critique (inscription → carte → favori → itinéraire →
signalement → déconnexion) tourne contre les **vrais services** : backend
Docker réel, OpenRouteService réel, MapTiler réel — aucun mock. Il faut donc
une connexion internet et les clés API configurées.

```bash
docker compose up -d          # backend + base (depuis la racine)
cd frontend && npm run dev    # serveur Vite sur :5173 (autre terminal)
npm run test:e2e              # Edge headless (canal msedge, pas d'install navigateur)
```

Les comptes `e2e-*@example.com` restant en base sont des artefacts de test
attendus (base de dev), pas un problème — aucun nettoyage automatique.

## Architecture

```
PWA (Vite + React + TS) — carte + auth fonctionnelles
        │  HTTP / JSON (cookies httpOnly, proxy Vite en dev)
        ▼
Backend Fastify (Node.js)
  ├── modules/auth       — signup, login, logout, session
  ├── modules/stops      — recherche géospatiale (PostGIS), détail arrêt
  ├── modules/favorites  — favoris utilisateur
  ├── modules/reports    — signalements communautaires + modération admin
  └── modules/routing    — proxy OpenRouteService (calcul d'itinéraire, 3 profils réels)
        │  Prisma
        ▼
PostgreSQL 16 + PostGIS (Docker, volume persistant)

Hors chemin de requête (batch, pas d'appel synchrone) :
  src/scripts/import-gtfs.ts — import ponctuel des données GTFS
```

Chaque module suit la même convention : `*.schemas.ts` (validation Zod), `*.service.ts` (logique métier, jamais dans les routes), `*.routes.ts` (HTTP pur). Voir `backend/src/modules/auth/` comme référence.

## Endpoints

| Méthode | Route | Auth requise | Description |
|---|---|---|---|
| GET | `/api/health` | — | Vérifie la connexion à la base |
| POST | `/api/auth/signup` | — | Créer un compte |
| POST | `/api/auth/login` | — | Se connecter (rate-limité) |
| POST | `/api/auth/logout` | session | Se déconnecter (révoque la session) |
| GET | `/api/auth/me` | session | Utilisateur courant |
| GET | `/api/stops/nearby` | — | Arrêts à proximité (`lat`, `lon`, `radius`, `type`) |
| GET | `/api/stops/:id` | — | Détail d'un arrêt |
| POST | `/api/favorites` | session | Ajouter un favori |
| GET | `/api/favorites` | session | Lister ses favoris |
| DELETE | `/api/favorites/:stopId` | session | Retirer un favori |
| POST | `/api/reports` | session | Créer un signalement |
| GET | `/api/reports/mine` | session | Lister ses propres signalements |
| GET | `/api/admin/reports` | session + rôle ADMIN | Lister tous les signalements (filtrable par `status`) |
| PATCH | `/api/admin/reports/:id` | session + rôle ADMIN | Modérer un signalement |
| GET | `/api/route` | — | Calculer un itinéraire (`from`, `to` en `lat,lon`, `profile` : `driving-car`/`foot-walking`/`cycling-regular`) |

Toutes les réponses suivent le format `{ success: boolean, data?, error?, code? }`.

## Décisions d'architecture (résumé)

Le détail complet (alternatives considérées, justifications) a été discuté en amont de ce projet. En bref :

- **Sessions opaques en base plutôt que JWT** : révocation immédiate possible (nécessaire pour la modération), pas de gestion de refresh token côté client.
- **Fastify plutôt que NestJS** : structure suffisante pour un MVP sans le poids d'un framework à decorators/DI.
- **PostgreSQL + PostGIS plutôt que bounding-box + calcul JS** : recherche de proximité indexée (`ST_DWithin` + index GiST), pas de scan complet même à grande échelle.
- **Import GTFS batch plutôt qu'appels Overpass en direct** : voir [backend/data/gtfs-abidjan/README.md](backend/data/gtfs-abidjan/README.md) — les tags OSM spécifiques au transport informel ivoirien (`gbaka=yes`, etc.) se sont révélés quasiment vides en interrogation directe ; le flux GTFS JungleBus fournit une topologie réelle et déjà structurée par opérateur.
- **Pas de Redis/queue/microservices** : volume et besoins du MVP ne le justifient pas.

## Pourquoi cette reconstruction

L'ancien projet (Next.js + Firebase + Neon + Overpass en direct) a fait l'objet d'un audit qui a trouvé, entre autres : des endpoints d'administration accessibles sans authentification, une application mobile qui ne compilait pas, et des données cartographiques à 99 % inexploitables (arrêts sans nom, faux positifs sur les tags OSM). Cette reconstruction reprend ce qui fonctionnait (le modèle de données Prisma était solide) et corrige le reste avec un périmètre volontairement réduit à un MVP.

## Limites connues du MVP (volontaires)

- Calcul d'itinéraire via OpenRouteService (3 profils réels : voiture/vélo/marche, vérifiés empiriquement distincts — contrairement au serveur démo OSRM initialement utilisé, qui renvoyait la même distance/durée quel que soit le profil demandé). Nécessite une clé API gratuite (`ORS_API_KEY`).
- Pas de météo, pas de mode hors-ligne, pas d'historique de recherche, pas de comparaison multi-modes — reportés en V2/V3.
- Les données GTFS importées datent de fin 2021 (horaires obsolètes) ; seule la topologie (arrêts, lignes, dessertes) est utilisée, jamais les horaires.
- Pas de CI/CD pour l'instant — choix assumé tant que le MVP n'est pas stabilisé.
