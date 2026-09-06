# PROJECT MEMORY — GbakaMap MVP

> **Règle d'usage** : toute nouvelle session (humaine ou IA) travaillant sur ce projet doit lire ce fichier en premier. Toute session qui termine un travail significatif doit le mettre à jour avant de s'arrêter. Ne jamais y inscrire une hypothèse comme si c'était une décision validée — si ce n'est pas vérifié, l'écrire explicitement comme "à vérifier" ou "supposé, non confirmé".

Dernière mise à jour : **2026-09-06 19:20**, par la session Claude Opus 5 qui a construit ce projet depuis son démarrage.

**Règle adoptée pendant cette session (2026-09-06 17:05), à appliquer systématiquement** : avant d'adopter tout nouvel outil/service externe dans ce projet (librairie, API tierce, etc.), faire une recherche réelle (web + test empirique si possible) sur sa fiabilité/ses limites plutôt que de se fier à sa réputation ou sa documentation seule — c'est exactement ce qui a révélé qu'OSRM ne distinguait pas ses profils malgré ce qu'affirme sa propre doc (voir §4).

---

## 1. Informations générales

**Nom du projet** : GbakaMap MVP — application de localisation des transports informels (bus, gbaka, woro-woro) en Côte d'Ivoire.

**Ce projet est une reconstruction volontaire.** Il existe deux autres dépôts sur cette machine qui ne font PAS partie de ce projet mais en sont l'origine :
- `C:\Users\HP\Desktop\Projet\GbakaMaps` — ancien backend (Next.js + Firebase + Neon), audité en détail (voir §7 "Audit de l'ancien projet" plus bas). **Ne pas y toucher, ne pas en réutiliser le code**, seulement les enseignements de l'audit et son flux GTFS/schéma Prisma comme référence.
- `C:\Users\HP\Desktop\Projet\appli_mobile_gbakamap` — ancienne app mobile React Native (ne compilait pas). Repoussée en V2, hors périmètre actuel.

**Localisation de ce projet** : `C:\Users\HP\Desktop\Projet\gbakamap-mvp`

**Décision produit fondatrice** (validée par l'utilisateur) : reconstruire un MVP simple, sûr, auto-hébergé, en abandonnant Next.js/Firebase/Neon/Overpass-en-direct au profit de Fastify/PostgreSQL-Docker/sessions-maison/import-GTFS-batch. Détail des arbitrages en §4.

---

## 2. État actuel du projet

### Fonctionnalités implémentées ✅

**Backend** (Fastify, `backend/`) :
- `auth` — signup, login (rate-limité), logout, `/me`, sessions opaques en base, argon2id
- `stops` — recherche géospatiale PostGIS (`ST_DWithin` + index GiST), détail d'un arrêt
- `favorites` — ajout/liste/suppression, scopé strictement par utilisateur (protection IDOR testée)
- `reports` — création de signalement, liste "mes signalements", modération admin (liste + changement de statut), protection `requireAdmin` stricte (écran admin frontend maintenant fait aussi, voir plus bas)
- `routing` — proxy OSRM (calcul d'itinéraire, un seul profil "driving" exposé — voir §4)
- Import batch GTFS réel (JungleBus, Grand Abidjan) : 3 820 arrêts nommés, 391 lignes bus/gbaka/woro-woro

**Frontend** (Vite + React 19 + PWA, `frontend/`) :
- Carte MapLibre + MapTiler (5 styles commutables : rues/basique/plein air/satellite/hybride), fallback OSM si clé absente
- Géolocalisation réelle, bouton recentrer, marqueur de position
- Panneau détail d'arrêt (bottom-sheet mobile / panneau latéral desktop responsive)
- Pages login/signup fonctionnelles, routage react-router-dom (`/`, `/login`, `/signup`, `/favorites`, `/reports`, `/admin/reports`)
- Bandeau d'état de connexion (`AuthStatus`) intégré à la page d'accueil, avec liens Favoris/Signalements (connecté) et Modération (admin uniquement)
- Panneau détail d'arrêt enrichi : favori, calcul d'itinéraire (3 profils ORS, tracé sur la carte), signalement (formulaire inline)
- Écran `/reports` (mes signalements) et `/admin/reports` (modération : filtres par statut, actions Approuver/Rejeter/Résoudre)
- "Suivre mon trajet" : une fois un itinéraire calculé, suivi GPS continu du passager (pas du véhicule), alerte d'approche (<150m) puis d'arrivée (<30m, arrêt automatique du suivi)
- Icônes SVG inlinées depuis Lucide (licence documentée)

**Tests** :
- Backend : **52 tests** d'intégration réels (vitest + vraie base PostgreSQL/PostGIS dockerisée, zéro mock de la DB)
- Frontend : **47 tests** de composants/hooks (vitest + jsdom + testing-library, fetch mocké)
- **End-to-end : 1 parcours critique complet** (`frontend/e2e/critical-path.spec.ts`, Playwright, canal msedge) tournant contre les **vrais services** (backend Docker, OpenRouteService, MapTiler, zéro mock) : inscription → carte → favori → itinéraire → signalement → déconnexion

### Fonctionnalités en cours / partiellement faites 🚧

- Rien "en cours" au sens strict au moment de la rédaction — **tous les écrans MVP haute priorité ET le différenciateur "Suivre mon trajet" (§5bis) sont maintenant terminés et commités**.

### Fonctionnalités restantes ❌ (au-delà du MVP core + différenciateur, voir §9 pour le détail priorisé)

- ~~Tests end-to-end automatisés~~ ✅ fait (commit `90e5f15`) — reste 🟢 : accessibilité systématique, code-splitting, tarifs des lignes

### Explicitement HORS MVP (décision produit, pas oubli)

Météo, mode hors-ligne, historique de recherche, comparaison d'itinéraires multi-modes, notifications push, notation des arrêts, app mobile native, CI/CD, WebSocket/realtime (voir §4 pour la réflexion WebSocket).

### État global

**Backend : solide et testé.** Tous les modules du périmètre MVP existent, sont testés (52/52), et ont été vérifiés en conteneur Docker. **Frontend : MVP complet + différenciateur.** Carte, auth, favoris, itinéraire, signalements, modération admin et "Suivre mon trajet" fonctionnent tous et ont été vérifiés en navigateur réel (Playwright, pas seulement `tsc`/`build`/`vitest`) — y compris une simulation GPS complète pour le suivi. Prochaine étape : items 🟠/🟢 restants de §9 (tests e2e automatisés, accessibilité, code-splitting, tarifs).

---

## 3. Stack et architecture

### Backend
- **Framework** : Fastify (Node.js, TypeScript, ESM)
- **ORM** : Prisma 6.13
- **Base de données** : PostgreSQL 16 + extension PostGIS, dans Docker (`postgis/postgis:16-3.4`), volume nommé `gbakamap_db_data`
- **Auth** : sessions opaques stockées en base (table `Session`), cookie httpOnly, argon2id pour les mots de passe. **Pas de JWT côté client, pas de Firebase.**
- **Validation** : Zod, sur tous les schémas d'entrée
- **Tests** : Vitest, contre une vraie base (pas de mocks DB)
- **Services externes** : OSRM (`router.project-osrm.org`, public, un seul profil réellement fonctionnel — voir §4), MapTiler (clé API frontend), Overpass (utilisé seulement de façon empirique pour l'audit de fiabilité des données, pas dans le pipeline d'import final)

### Frontend
- **Framework** : Vite + React 19 + TypeScript
- **State serveur** : TanStack Query
- **Routage** : react-router-dom (`createBrowserRouter`)
- **Carte** : MapLibre GL JS + styles vectoriels MapTiler
- **PWA** : vite-plugin-pwa (manifest + service worker)
- **Tests** : Vitest + jsdom + @testing-library/react (fetch mocké)
- **Icônes** : SVG copiés individuellement depuis Lucide (licence ISC/MIT), pas de dépendance `lucide-react` (bundle déjà lourd, ~1,3 Mo à cause de MapLibre)

### Docker / infra
- `docker-compose.yml` à la racine : 2 services (`db`, `backend`), le frontend tourne en dev via `npm run dev` (pas dockerisé, pas nécessaire)
- **Deux `.env` distincts, ne pas confondre** :
  - `.env` (racine) → alimente `docker-compose.yml`, `DATABASE_URL` utilise le hostname interne Docker `db`
  - `backend/.env` → alimente le process Node lancé directement sur l'hôte (`npm run dev`, tests, scripts Prisma), `DATABASE_URL` utilise `localhost:5433` (port exposé, **pas 5432** — un PostgreSQL natif Windows préexistant occupe déjà 5432 sur cette machine)
  - `frontend/.env` → `VITE_API_URL=/api` (relatif, voir §4 sur le proxy Vite) + `VITE_MAPTILER_KEY` (clé personnelle de l'utilisateur, jamais commitée)

### Structure du dépôt

```
gbakamap-mvp/
├── backend/
│   ├── src/modules/{auth,stops,favorites,reports,routing,health}/
│   │   └── *.schemas.ts / *.service.ts / *.routes.ts (convention stricte)
│   ├── src/common/ (errors.ts, auth-middleware.ts, serialize.ts)
│   ├── src/scripts/import-gtfs.ts
│   ├── data/gtfs-abidjan/ (données GTFS réelles, committées, ~884 Ko)
│   ├── prisma/schema.prisma + migrations/
│   └── tests/*.test.ts (50 tests)
├── frontend/
│   ├── src/pages/ (HomePage, LoginPage, SignupPage)
│   ├── src/components/ (StopsMap, AuthStatus, icons/)
│   ├── src/hooks/ (useAuth, useHealth, useNearbyStops)
│   ├── src/lib/api/ (client.ts, types.ts)
│   └── src/test/ (setup.ts, utils.tsx)
├── docker-compose.yml
├── README.md (documentation utilisateur/développeur — à consulter aussi)
└── PROJECT_MEMORY.md (ce fichier)
```

### Endpoints backend (14 au total)

Voir le tableau complet dans `README.md` §Endpoints — reproduit ici pour référence rapide :

| Méthode | Route | Auth |
|---|---|---|
| GET | `/api/health` | — |
| POST | `/api/auth/signup` | — |
| POST | `/api/auth/login` | — (rate-limité) |
| POST | `/api/auth/logout` | session |
| GET | `/api/auth/me` | session |
| GET | `/api/stops/nearby` | — |
| GET | `/api/stops/:id` | — |
| POST/GET/DELETE | `/api/favorites` | session |
| POST | `/api/reports` | session |
| GET | `/api/reports/mine` | session |
| GET/PATCH | `/api/admin/reports` | session + rôle ADMIN |
| GET | `/api/route` | — |

---

## 4. Décisions techniques

### 2026-09-05 — Abandon de Next.js/Firebase/Neon/Overpass-direct

**Décision** : reconstruire sur Fastify + PostgreSQL/PostGIS Docker + sessions maison + import GTFS batch.
**Pourquoi** : l'audit de l'ancien projet (voir §7) a trouvé des failles critiques (endpoints admin sans auth), une app mobile qui ne compilait pas, et des données à 99% inexploitables.
**Conséquence** : ce nouveau dépôt (`gbakamap-mvp`), architecture from scratch.

### 2026-09-06 00:40 — Fastify plutôt que NestJS

**Décision** : Fastify.
**Pourquoi** : structure suffisante pour un MVP sans le poids d'un framework à decorators/DI ; NestJS se justifierait si l'équipe grandissait vite, pas le cas.

### 2026-09-06 00:40 — Sessions opaques plutôt que JWT

**Décision** : sessions stockées en base, cookie httpOnly, pas de JWT côté client.
**Pourquoi** : révocation immédiate nécessaire pour la modération (bannir un utilisateur doit couper l'accès tout de suite) ; mono-backend donc pas besoin du côté stateless du JWT.
**Conséquence acceptée** : un lookup DB par requête authentifiée — acceptable au volume du MVP.

### 2026-09-06 01:05 — GTFS JungleBus plutôt qu'Overpass en direct

**Décision** : import batch depuis le flux GTFS JungleBus (Grand Abidjan) plutôt que des requêtes Overpass en temps réel.
**Pourquoi** : vérifié empiriquement que les tags OSM spécifiques au transport informel ivoirien (`gbaka=yes`, `woro_woro=yes`, etc.) retournent quasiment 0 résultat sur le terrain. Le flux GTFS JungleBus fournit une topologie réelle déjà structurée par opérateur (24 opérateurs, dont 9 réseaux gbaka et 11 réseaux woro-woro par commune).
**Résultat mesuré** : 3 820 arrêts tous nommés (0% sans nom, contre 99,3% dans l'ancien projet), 99,7% rattachés à au moins une ligne (contre 0,06%).
**Limite documentée** : les horaires de ce flux datent de fin 2021 (obsolètes) — seule la topologie (arrêts/lignes/dessertes) est utilisée, jamais les horaires. Transport lagunaire (ferry) explicitement exclu du périmètre MVP.

### 2026-09-06 01:05 — PostGIS plutôt que bounding-box + Haversine JS

**Décision** : colonne géographique PostGIS (`geog`) synchronisée par trigger SQL depuis lat/lon, requêtes `ST_DWithin` sur index GiST.
**Pourquoi** : corrige la limite de l'ancien projet (scan + calcul Haversine en JavaScript, non indexé).
**Contrainte technique** : Prisma ne modélise pas nativement les types géographiques — utilisation de `Unsupported(...)` dans le schéma + requêtes `$queryRaw` paramétrées (`Prisma.sql`, donc protégées contre l'injection) pour les calculs spatiaux.

### 2026-09-06 01:27 — Un seul profil OSRM exposé ("driving") — **SUPERSEDÉE le 2026-09-06 17:xx, voir plus bas**

**Décision (obsolète)** : ne pas exposer de choix de mode de trajet (marche/vélo/voiture) côté API/UI.
**Pourquoi** : vérifié empiriquement contre `router.project-osrm.org` que les profils `walking`/`cycling`/`driving` renvoient EXACTEMENT la même distance/durée sur un même trajet — preuve que ce serveur démo public ne route en réalité que sur le graphe voiture. Exposer un choix de mode aurait affiché un temps de marche = temps en voiture, ce qui est trompeur.
**Remplacée par** : la décision OpenRouteService ci-dessous — le problème (profils non distincts) a été résolu en changeant de fournisseur plutôt qu'en attendant une instance auto-hébergée.

### 2026-09-06 17:xx — OSRM remplacé par OpenRouteService : profils réellement distincts

**Décision** : remplacer OSRM (`router.project-osrm.org`) par [OpenRouteService](https://openrouteservice.org) (HeiGIT, université de Heidelberg) pour le calcul d'itinéraire, avec 3 profils exposés : `driving-car`, `foot-walking`, `cycling-regular`.
**Pourquoi** : suite à une demande explicite de l'utilisateur de rechercher un meilleur outil. Vérifié empiriquement (2 trajets Abidjan différents) qu'OSRM démo renvoie une distance/durée strictement identique quel que soit le profil — confirmé une seconde fois avec un troisième trajet plus long (Plateau→Yopougon), donc pas un hasard de coordonnées. La documentation OSRM elle-même prévient : "pas de garantie d'exactitude des résultats, serveur de démonstration, pas prêt pour la production".
**Vérification empirique du remplacement (avec la vraie clé de l'utilisateur, sur Plateau→Cocody)** :
  - `driving-car` : 6077,5 m, 621 s (10,3 min)
  - `cycling-regular` : 7363 m (chemin différent), 1492,8 s (24,9 min)
  - `foot-walking` : 6047,3 m, 4354 s (72,6 min)
  → Les 3 profils sont bien distincts, contrairement à OSRM.
**Contrainte** : `ORS_API_KEY` est **requis** (le serveur refuse de démarrer sans, comme `DATABASE_URL`/`SESSION_SECRET`) — compte gratuit sur openrouteservice.org, pas de carte bancaire, quota ~2000-2500 requêtes/jour. Même friction d'adoption que `VITE_MAPTILER_KEY` côté frontend.
**Fichiers concernés** : `backend/src/config/env.ts` (ORS_API_KEY remplace OSRM_URL), `backend/src/modules/routing/routing.schemas.ts` (nouveau param `profile`), `backend/src/modules/routing/routing.service.ts` (réécrit pour l'API ORS — `POST /v2/directions/{profile}/geojson`, header `Authorization`), `backend/tests/routing.test.ts` (mocks adaptés au format de réponse ORS + un nouveau test qui vérifie explicitement que `foot-walking` et `driving-car` donnent des durées différentes), `docker-compose.yml` (variable d'environnement transmise au conteneur), `.env.example` + `backend/.env` (clé).
**Bug rencontré pendant la migration** : après avoir changé `.env`/`backend/.env`, le conteneur Docker recréé démarrait quand même en erreur "ORS_API_KEY manquant" — cause : `docker-compose.yml` listait encore explicitement `OSRM_URL: ${OSRM_URL}` dans `environment:` du service `backend` et ne transmettait pas `ORS_API_KEY`. Corrigé en remplaçant cette ligne. **Leçon** : lors du remplacement d'une variable d'environnement, penser à `docker-compose.yml` en plus des fichiers `.env` eux-mêmes — Docker Compose ne transmet que les variables explicitement listées dans `environment:`, pas tout le `.env` en vrac.

### 2026-09-06 (squelette frontend) — MapTiler plutôt que Google Maps ou OSM brut

**Décision** : carte MapLibre + styles vectoriels MapTiler (clé API gratuite requise, `VITE_MAPTILER_KEY`).
**Pourquoi** : l'ancien projet utilisait Google Maps avec une clé jamais configurée (`YOUR_GOOGLE_MAPS_API_KEY_*` en dur, jamais remplacée). MapTiler offre un rendu vectoriel net et détaillé avec un compte gratuit sans carte bancaire.
**Repli** : si la clé est absente, bascule automatique sur des tuiles OSM brutes — l'app reste utilisable pendant la configuration, jamais un écran cassé.
**Décision complémentaire** (suite à question utilisateur) : 5 styles commutables en direct (rues/basique/plein air/satellite/hybride) — tous vérifiés répondants en HTTP 200 avec la clé réelle de l'utilisateur.

### 2026-09-06 — CORS multi-origine (tunnel de test)

**Décision** : `FRONTEND_ORIGIN` accepte une liste séparée par des virgules (ou `*`, jamais accepté en production) plutôt qu'une seule origine fixe.
**Pourquoi** : l'utilisateur teste l'app via un tunnel VS Code (URL publique HTTPS) en plus de `localhost:5173`, pour tester depuis son téléphone.
**Implémentation** : `isAllowedOrigin()` dans `backend/src/config/env.ts`, utilisée à la fois par le plugin CORS et par la garde CSRF sur les mutations (les deux vérifiaient auparavant une égalité stricte contre une seule valeur).

### 2026-09-06 — Proxy Vite pour cookies same-origin

**Décision** : `VITE_API_URL=/api` (relatif) + proxy Vite (`server.proxy['/api'] → http://localhost:4000`) plutôt qu'une URL absolue avec CORS cross-origin.
**Pourquoi** : évite la jonglerie CORS/credentials, le cookie de session (SameSite=Lax) part sans complication puisque front et API sont vus comme same-origin par le navigateur.
**⚠️ Implication pour le déploiement** : la même règle de proxy (`/api` → backend) devra être reproduite côté reverse proxy en production (nginx ou équivalent), sinon le front pointera vers lui-même et tout appel API échouera en 404 — **exactement le bug rencontré et corrigé le 2026-09-06** (voir §5).

### 2026-09-06 — Icônes copiées individuellement plutôt que `lucide-react`

**Décision** : copier le SVG des icônes nécessaires (7 à ce jour : recentrer, fermer, chargement, œil, œil-barré) dans `frontend/src/components/icons/index.tsx`, avec attribution de licence dans `LICENSES-ICONS.md`, plutôt qu'ajouter la dépendance `lucide-react`.
**Pourquoi** : le bundle est déjà à ~1,3 Mo à cause de MapLibre — pas de librairie d'icônes complète pour une poignée d'usages.

### 2026-09-06 — WebSocket/realtime : reporté en V2, décision réfléchie mais non implémentée

**Contexte** : l'utilisateur a demandé une réflexion sur l'intégration de WebSockets pour du realtime.
**Constat clé** : il n'existe **aucune source de données GPS** pour les gbaka/woro-woro (véhicules informels sans télémétrie) — faire du "realtime" sur des positions de véhicules inexistantes serait de la façade, pas une fonctionnalité.
**Cas d'usage réellement valables identifiés** (V2, pas MVP) : notifier un modérateur en direct à l'arrivée d'un nouveau signalement ; notifier un utilisateur du traitement de son signalement.
**Design esquissé (non implémenté)** : `@fastify/websocket`, auth par cookie de session réutilisé à l'upgrade, deux canaux (`admin:reports` broadcast, `user:<id>:reports` ciblé), pas de Redis pub/sub tant qu'il n'y a qu'une seule instance backend.
**Statut** : **aucun code écrit**. Décision explicite de ne pas l'implémenter maintenant — les écrans manquants (favoris, signalements, modération) ont plus de valeur immédiate.

---

## 5. Problèmes et solutions

### 2026-09-06 00:40 — Conflit de port PostgreSQL (5432 déjà occupé)

**Symptôme** : `prisma migrate dev` échoue avec une erreur d'authentification trompeuse contre le PostgreSQL Docker.
**Cause** : un PostgreSQL natif Windows tourne déjà sur le port 5432 de la machine, intercepte la connexion avant le conteneur Docker.
**Solution** : `POSTGRES_PORT=5433` dans `.env` — le port INTERNE du réseau Docker reste 5432 (aucun changement applicatif), seul le port exposé sur l'hôte change.
**Fichiers concernés** : `.env`, `.env.example`, `docker-compose.yml` (aucun changement nécessaire dans ce dernier, juste la variable).
**À ne pas reproduire** : ne pas supposer que 5432 est libre sur une machine de développeur Windows sans vérifier (`netstat -ano | grep 5432`).

### 2026-09-06 01:15 — Bug BigInt non sérialisable

**Symptôme** : `500 - Do not know how to serialize a BigInt` sur `/api/stops/nearby` et `/api/stops/:id` dès que de vraies données GTFS (avec `osmId` en BigInt) ont été importées — invisible avec des données de test synthétiques sans `osmId`.
**Cause** : Fastify (comme `JSON.stringify` natif) ne sait pas sérialiser un `BigInt`.
**Solution** : fonction `serializeStopBigInt()` dans `backend/src/common/serialize.ts`, appliquée dans `stops.service.ts` et `favorites.service.ts` (factorisée après avoir été dupliquée une première fois).
**Fichiers concernés** : `backend/src/common/serialize.ts`, `backend/src/modules/stops/stops.service.ts`, `backend/src/modules/favorites/favorites.service.ts`.
**Leçon** : ce bug n'est apparu qu'après l'import de vraies données — les tests avec données synthétiques minimalistes peuvent masquer des bugs de sérialisation sur des types qui n'apparaissent qu'en production.

### 2026-09-06 (session Docker) — `taskkill` a tué Docker Desktop par erreur

**Symptôme** : Docker inaccessible (`docker info` → échec de connexion au pipe).
**Cause** : un `taskkill //F //PID <pid>` sur le port 4000, censé cibler un process de test, a en réalité tué `com.docker.backend.exe` (Docker Desktop lui-même faisait du port-proxying).
**Solution appliquée** : l'utilisateur a relancé Docker Desktop manuellement. Les conteneurs (`restart: unless-stopped`) et le volume de données ont repris sans perte.
**À ne surtout pas reproduire** : ne plus jamais faire `taskkill` sur un PID trouvé par scan de port sans avoir vérifié via `tasklist //FI "PID eq <pid>"` que le process est bien celui qu'on croit (ex: vérifier que le nom contient bien `node.exe` avant de tuer). **Règle adoptée depuis** : utiliser `TaskStop` (arrêt par ID de tâche suivi par le harnais) pour arrêter les process qu'on a soi-même démarrés en arrière-plan, et systématiquement vérifier le nom du process avant tout `taskkill` par PID scanné.

### 2026-09-06 16:36 — Conteneur backend connecté à l'ancienne base Neon (incident sérieux)

**Symptôme** : `/api/health` intermittent (200 puis 500), logs backend montrant `Can't reach database server at ep-steep-king-adcqwujq-pooler.c-2.us-east-1.aws.neon.tech` — l'URL Neon de **l'ancien projet audité**, pas la base locale.
**Cause** : Docker ne relit les variables d'environnement (`.env`) qu'à la (re)création d'un conteneur, jamais à un simple redémarrage. Le conteneur `backend` tournait depuis 14h avec une valeur de `DATABASE_URL` figée au moment de sa création — probablement issue d'une expérimentation ou d'un `.env` temporairement modifié puis revenu à sa valeur correcte sans jamais recréer le conteneur.
**Impact réel** : aucune écriture n'a eu lieu (le seul appel routé vers cette base était le health check, en lecture seule `SELECT 1`). Le "200" intermittent s'explique probablement par l'auto-veille de Neon (réveil lent au premier essai).
**Solution** : `docker compose up -d --force-recreate backend` (a aussi recréé `db`, sans perte — volume nommé persistant, vérifié après coup avec une requête réelle sur les données GTFS).
**Fichiers concernés** : aucun (config déjà correcte dans `.env` — c'est l'état du conteneur en mémoire qui était périmé, pas un fichier).
**Leçon / vigilance à maintenir** : **après toute modification de `.env` racine, toujours vérifier `docker compose exec backend printenv DATABASE_URL`** pour confirmer que le conteneur en cours d'exécution reflète bien le fichier actuel — ne jamais supposer qu'un `.env` correct implique un conteneur à jour.

### 2026-09-06 (module stops) — Migration Prisma échoue sur la shadow database

**Symptôme** : `prisma migrate dev` échoue avec `type "geography" does not exist` lors de l'ajout de la colonne PostGIS.
**Cause** : la "shadow database" que Prisma crée pour valider les migrations est vierge (pas d'extension PostGIS), contrairement à la base réelle qui utilise l'image `postgis/postgis`.
**Solution** : ajout de `CREATE EXTENSION IF NOT EXISTS postgis;` dans la toute première migration (`init`), pas seulement celle qui introduit la colonne géographique — la shadow DB rejoue tout l'historique depuis zéro.
**Fichiers concernés** : `backend/prisma/migrations/20260906002837_init/migration.sql`.

### 2026-09-06 (squelette frontend) — Page blanche : alias `@/*` absent de `vite.config.ts`

**Symptôme** : page complètement blanche en dev, alors que `tsc --noEmit` et `vite build` passaient tous les deux sans erreur.
**Cause** : l'alias `@/*` était déclaré dans `tsconfig.json` (paths) mais jamais configuré dans `vite.config.ts` — Vite ne lit PAS les `paths` de tsconfig. `tsc` passait car il les lit, lui ; le serveur de dev renvoyait 500 sur tout module important `@/...` au runtime.
**Solution** : ajout de `resolve.alias['@']` dans `vite.config.ts` pointant vers `./src`.
**Fichiers concernés** : `frontend/vite.config.ts`.
**Leçon majeure, à ne jamais oublier** : `tsc` et `vite build` NE SUFFISENT PAS à garantir qu'une app fonctionne réellement — un test visuel en navigateur réel (Playwright) est nécessaire avant de déclarer un travail frontend "terminé". Cette leçon s'est confirmée une seconde fois (voir bug proxy ci-dessous).

### 2026-09-06 (squelette frontend) — Carte vide, zéro marqueur : maplibre-gl pré-bundlé

**Symptôme** : la carte s'affichait (tuiles, contrôles) mais aucun marqueur n'apparaissait ; `mapCanvasPresent: true` mais `markerCount: 0`.
**Cause** : `maplibre-gl` charge son moteur de rendu dans un Web Worker ; le pré-bundling de dépendances de Vite casse ce chargement en dev (404 sur `maplibre-gl-worker.mjs`), l'événement `load` de la carte n'est jamais émis.
**Solution** : `optimizeDeps.exclude: ['maplibre-gl']` dans `vite.config.ts`.
**Fichiers concernés** : `frontend/vite.config.ts`.
**Diagnostic utile pour la suite** : tester le rendu MapLibre en headless nécessite de forcer un rendu logiciel WebGL (`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` sur Chromium/Edge), sinon `webgl2: false` et la carte ne rend jamais dans un test automatisé.

### 2026-09-06 (auth screens) — Signup renvoie 404 : proxy Vite manquant

**Symptôme** : `POST /api/auth/signup` → 404, avec le message "Une erreur est survenue (404)" affiché dans le formulaire.
**Cause** : `VITE_API_URL` avait été changé en `/api` (relatif, intention : proxy dev pour cookies same-origin) mais **aucun proxy n'avait été configuré dans `vite.config.ts`** — la requête partait donc vers le serveur Vite lui-même (`localhost:5173/api/auth/signup`), qui ne connaît pas cette route.
**Solution** : ajout de `server.proxy['/api'] → { target: 'http://localhost:4000', changeOrigin: true }` dans `vite.config.ts`.
**Fichiers concernés** : `frontend/vite.config.ts`.
**⚠️ Vigilance déploiement** : cette règle de proxy devra être reproduite côté reverse proxy en production — sinon même bug en prod.

### 2026-09-06 (auth screens) — Logout renvoie 500, bouton reste bloqué

**Symptôme** : après signup réussi, cliquer sur "Déconnexion" renvoie une erreur 500 (`Body cannot be empty when content-type is set to 'application/json'`), l'utilisateur reste affiché comme connecté indéfiniment.
**Cause** : `frontend/src/lib/api/client.ts` fixait inconditionnellement `Content-Type: application/json`, même pour les requêtes sans corps (`api.post('/auth/logout')` sans argument `data`). Fastify refuse un corps vide envoyé avec ce header.
**Solution** : le header `Content-Type: application/json` n'est désormais posé que si `init.body` est effectivement présent.
**Fichiers concernés** : `frontend/src/lib/api/client.ts`.
**Leçon** : ce bug n'était détectable ni par les tests unitaires (fetch mocké, qui ne reproduit pas le comportement strict de Fastify) ni par `tsc`/`build` — seul un test de bout en bout contre le vrai backend l'a révélé.

### 2026-09-06 17:40 — Écran favoris : deux chevauchements de layout desktop en cascade

**Symptôme 1** : clic sur le bouton favori (ajouté dans le titre du panneau détail d'un arrêt) intercepté par le bouton fermer (X) du même panneau.
**Cause** : `.home__detail-close` est en `position:absolute` (top/right fixes) dans le coin du panneau ; le bouton favori, lui, est en flux normal dans `.home__detail-title` (flex row) et son cercle de 44px atterrit exactement dans la même zone.
**Solution** : `padding-right` sur `.home__detail-title` pour dégager la zone occupée par le bouton fermer.

**Symptôme 2 (introduit en corrigeant naïvement le symptôme 1 avec un z-index)** : après avoir donné à `.home__topbar` un `z-index` plus élevé que `.home__detail` pour que le lien "Favoris" ne soit plus caché par le panneau latéral desktop, c'est l'inverse qui s'est produit — la topbar (maintenant au-dessus dans l'empilement) intercepte les clics sur le bouton favori situé en haut du panneau, car les deux zones occupent le même espace écran (le panneau desktop démarrait à `top:0`, exactement sous la topbar).
**Cause profonde** : le problème n'était pas un conflit d'empilement (z-index) mais un chevauchement spatial réel entre deux zones qui n'auraient jamais dû se recouvrir.
**Solution correcte** : séparation spatiale. Nouvelle variable CSS `--topbar-height: 3.625rem` (mesurée réellement via un diagnostic Playwright, pas devinée), `.home__topbar` passe de `min-height` variable à `height` fixe, et `.home__detail` (variante desktop uniquement, media query `min-width:768px`) démarre à `top: var(--topbar-height)` au lieu de `top: 0`.
**Fichiers concernés** : `frontend/src/index.css`.
**Leçon** : un premier correctif basé sur le z-index a semblé résoudre le problème signalé (le lien redevenait cliquable) mais a déplacé le bug ailleurs sans le résoudre — revérifier par un test de bout en bout APRÈS un correctif de layout, pas seulement constater que le symptôme initial a disparu. Un problème de chevauchement spatial se corrige dans l'espace (positions/dimensions), pas par une course à l'empilement (z-index).

### 2026-09-06 19:05 — Délégation OpenCode avortée silencieusement (permission refusée)

**Symptôme** : une délégation (suite e2e) s'est terminée avec `exit code 0` (donc apparemment "réussie") sans avoir écrit le moindre fichier ni créé de liste de tâches — juste une phase d'exploration puis un arrêt net.
**Cause** : l'agent a tenté de lire `frontend/.env` (pas nécessaire pour sa tâche, juste de la curiosité exploratoire), la politique de permission de l'environnement a auto-rejeté cette lecture, et l'agent s'est arrêté au lieu de continuer sans ce fichier.
**Solution** : relance de la même tâche avec une instruction explicite en tête de spec ("ne lis aucun fichier `.env`, tu n'en as pas besoin, un refus de permission ne doit pas t'arrêter") — la relance a fonctionné du début à la fin.
**Leçon, à appliquer à toute future délégation** : un `exit code 0` ne prouve PAS qu'un agent a fait le travail demandé — vérifier systématiquement qu'il a réellement produit les fichiers attendus (`git status --short`) avant de lire son rapport final en détail. Si une tâche implique des fichiers sensibles (`.env`, secrets), anticiper et interdire explicitement leur lecture dans la spec dès le départ plutôt que de découvrir le blocage après coup.

---

## 6. Historique des modifications (chronologique, par commit)

| Date/heure | Commit | Travail effectué | Résultat |
|---|---|---|---|
| 2026-09-06 00:40 | `4691085` | Squelette backend Fastify + Docker + module `auth` complet | 10 tests, `docker compose up -d --build` validé de bout en bout |
| 2026-09-06 01:05 | `732a725` | Module `stops` (PostGIS) + import GTFS réel Grand Abidjan | 21 tests, 3820 arrêts réels importés, bug BigInt trouvé et corrigé |
| 2026-09-06 01:12 | `0cace68` | Module `favorites`, délégué à OpenCode (1ère délégation réussie) | 29 tests, IDOR vérifié |
| 2026-09-06 01:22 | `c48d427` | Module `reports`, délégué à OpenCode | 42 tests, faille admin de l'ancien projet vérifiée absente (401 confirmé) |
| 2026-09-06 01:27 | `952b40d` | Module `routing`, écrit directement (pas délégué) | 50 tests, décision "un seul profil OSRM" prise après vérification empirique |
| 2026-09-06 01:29 | `8408393` | README du monorepo | Documentation setup/architecture/endpoints |
| 2026-09-06 01:49 | `6321a96` | Squelette frontend PWA (Vite+React+MapLibre) | Build + PWA générés, MapTiler intégré sur demande utilisateur |
| 2026-09-06 02:14 | `818eb8b` | Passe UX/UI, délégué à OpenCode | 2 bugs bloquants trouvés et corrigés (alias `@`, maplibre worker) via test visuel réel |
| 2026-09-06 16:37 | `c02f6a4` | CORS multi-origine (tunnel) + icônes Lucide | Support tunnel VS Code pour test mobile |
| 2026-09-06 17:00 | `afd10c2` | Écrans auth (login/signup) + routage, délégué à OpenCode | 2 bugs runtime trouvés et corrigés (proxy Vite, Content-Type vide) via test navigateur réel |
| 2026-09-06 17:04 | `8ddfde9` | Création PROJECT_MEMORY.md | Mémoire persistante instaurée |
| 2026-09-06 17:23 | `63c66dd` | Remplacement OSRM → OpenRouteService, écrit directement | 52 tests backend, 3 profils réellement distincts vérifiés (10,3/24,9/72,6 min sur le même trajet) |
| 2026-09-06 17:45 | `3494b9e` | Écran favoris, délégué à OpenCode | 2 bugs de layout desktop trouvés et corrigés (chevauchement bouton favori/fermer, puis panneau/topbar) via test navigateur réel |
| 2026-09-06 18:14 | `be04a90` | Écran itinéraire intégré à la carte, délégué à OpenCode | 17/17 tests, flux complet vérifié en navigateur (760m/2min cohérent, tracé affiché), zéro bug de layout cette fois (panneau en flex-wrap, pas position:absolute) |
| 2026-09-06 18:2x | `0b30b51` | Écran signalements (formulaire inline + liste), délégué à OpenCode | 25/25 tests, vérification backend curl particulièrement complète par l'agent lui-même (4 cas), flux complet confirmé en navigateur, zéro bug de layout (3 boutons du panneau détail cohabitent) |
| 2026-09-06 18:55 | `0c44855` | Écran de modération admin (`/admin/reports`), délégué à OpenCode | 35/35 tests, vérification indépendante complète (tsc/vitest/build + test navigateur réel Playwright couvrant anonyme/non-admin/admin avec un vrai compte promu ADMIN en SQL, création+approbation réelle d'un signalement via l'UI, mobile vérifié) — **zéro bug trouvé**, tous les écrans MVP haute priorité (§9) sont désormais terminés |
| 2026-09-06 19:00 | `96b1f3a` | "Suivre mon trajet" (`useLiveTracking.ts` + intégration panneau itinéraire), délégué à OpenCode | 47/47 tests, vérification indépendante complète (tsc/vitest/build + **simulation GPS réelle en navigateur** via `context.setGeolocation()` sur 6 points interpolés vers un arrêt réel : distance décroissante affichée correctement, alerte d'approche puis d'arrivée au bon moment, arrêt automatique du suivi confirmé) — **zéro bug trouvé**, différenciateur §5bis terminé |
| 2026-09-06 19:15 | `90e5f15` | Suite Playwright e2e committée (`frontend/e2e/critical-path.spec.ts`), délégué à OpenCode (1er essai avorté, retenté avec succès) | Parcours complet (inscription→carte→favori→itinéraire→signalement→déconnexion) contre les vrais services, zéro mock ; relancé indépendamment par mes soins (pas seulement le rapport de l'agent) → vert (~31s) ; comble la lacune "aucun test e2e committé" documentée depuis le début du projet |

---

## 5bis. Mode autonome (à partir du 2026-09-06 17:50)

**Directive de l'utilisateur** : la session opère désormais en mode autonome — décisions techniques/architecturales/UX de routine prises directement sans validation préalable ; validation utilisateur requise uniquement pour les opérations dangereuses/irréversibles (destruction de données, actions financières, déploiement prod risqué). Objectif révisé : dépasser le MVP pour viser un produit réellement abouti (UX soignée, accessibilité, performance, cohérence visuelle), avec une réflexion "temps réel" dès la conception (sans sur-construire prématurément), adapté spécifiquement au contexte ivoirien, recherché plutôt que supposé, et documenté au fil de l'eau dans ce fichier.

### Recherche réelle effectuée (2026-09-06 17:50) — mobilité en Côte d'Ivoire

Sources : recherche web réelle (pas une supposition), voir requêtes dans l'historique de session.

**Faits vérifiés** :
- La congestion routière coûterait 4 à 5 % du revenu national ivoirien par an (estimation Banque Mondiale, relayée par Ecofin Agency).
- Plus de 500 accidents corporels recensés sur les premiers mois de 2026, 164 morts, ~2000 blessés (source : Ecofin Agency).
- Une opération de répression ciblant spécifiquement les gbaka a été lancée fin août 2026 par la DGTTC (Direction Générale des Transports Terrestres et de la Circulation) — le secteur informel est sous pression réglementaire active, pas en voie de disparition mais en évolution.
- Le métro d'Abidjan (Ligne 1) est en phase d'électrification (début 2026), mise en service commerciale attendue **2029** — pas une solution à court/moyen terme.
- SOTRA a plus que doublé sa flotte (1022 bus en 2011 → 2050 en 2024), 200 bus supplémentaires livrés en juillet 2025 — le réseau formel se renforce mais reste minoritaire face à l'informel.

**Conclusion produit, tirée de ces faits (pas une hypothèse)** : le transport informel (gbaka/woro-woro) restera dominant pendant des années — les investissements dans GbakaMap sur ce secteur restent pertinents à moyen terme, pas obsolètes face au métro.

### Recherche réelle effectuée (2026-09-06 17:50) — bonnes pratiques UX transport (Citymapper/Moovit/Transit)

**Faits vérifiés** : Moovit et Transit App sont réputés les plus fiables sur les délais temps réel et les prédictions d'arrivée bus ; Citymapper se distingue sur la combinaison multimodale (métro+bus+ferry+vélo) en un seul plan de trajet. Bonnes pratiques citées : interface simplifiée, information claire, chargement rapide, accessibilité, widgets d'info plutôt que notifications intrusives, tenir l'utilisateur informé en cas de perturbation avec un nouveau plan de trajet proposé.

**Limite reconnue explicitement** : ces pratiques reposent sur des données temps réel de véhicules (GPS des bus/métros) que nous n'avons pas et ne pouvons pas obtenir pour les gbaka/woro-woro (aucune télémétrie n'existe côté opérateurs informels — fait déjà établi précédemment, reconfirmé ici). **Ne pas copier ces patterns tels quels** — les adapter à ce qui est réellement possible avec nos données (topologie GTFS statique + position du passager, pas du véhicule).

### Décision produit issue de cette recherche : "Suivre mon trajet" (passager, pas véhicule) — ✅ implémenté le 2026-09-06 19:00

**Idée retenue** : une fois qu'un itinéraire est calculé, permettre à l'utilisateur de "suivre" son trajet — sa propre position GPS progresse sur la carte le long du tracé (déjà renvoyé en GeoJSON par OpenRouteService), avec une alerte "vous approchez de votre arrêt/destination" à l'approche. **Ce n'est PAS du suivi de véhicule** (aucune donnée pour ça) — c'est un repère honnête pour l'utilisateur pendant son propre déplacement, qui répond à un vrai besoin (ne pas savoir où descendre, ne pas savoir combien de trajet il reste).
**Statut** : **implémenté et vérifié** (commit `96b1f3a`). `useLiveTracking.ts` (watchPosition continu + haversine), bouton "Suivre mon trajet" dans le panneau itinéraire, position injectée dans le marqueur utilisateur existant de `StopsMap` (aucun marqueur supplémentaire), alerte d'approche à 150m, arrivée + arrêt automatique du suivi à 30m. Vérifié par simulation GPS réelle en navigateur (Playwright `context.setGeolocation()`), zéro bug trouvé — voir §6.
**Ce qui ne sera PAS fait** (limite honnête à conserver) : position live des gbaka/woro-woro sur la carte (aucune source de données), ETA basé sur du trafic live (aucune source pour Abidjan identifiée à ce jour), notifications de retard de véhicule (rien à mesurer).

---

## 7. Audit de l'ancien projet (contexte, référence)

Un audit technique complet du projet précédent (`GbakaMaps`, Next.js/Firebase/Neon) a été réalisé avant de démarrer cette reconstruction. Conclusions clés qui ont motivé les décisions de ce nouveau projet :

- **Faille critique** : `/api/admin/reports` répondait 200 sans authentification, exposant les emails des utilisateurs. `PATCH /api/stops/[id]` était modifiable par n'importe qui.
- **Données** : 99,3% des 31 562 arrêts en base n'avaient pas de nom (cause : requête Overpass avec `>;` + `out skel qt`, tags OSM inventés qui ne renvoyaient aucun résultat en pratique).
- **App mobile** : ne compilait pas (28 erreurs TypeScript), clés Firebase/Google Maps jamais configurées.
- **Score global de l'audit** : 3,1/10.

Ce fichier ne reproduit pas l'audit complet (trop long) — se référer à la conversation d'origine si le détail est nécessaire. Les décisions de ce nouveau projet qui en découlent directement sont documentées en §4 avec leur justification.

---

## 8. Points d'attention

### Bugs connus / non résolus
- Aucun bug connu non résolu au 2026-09-06 17:05.

### Risques techniques identifiés
- **Bundle frontend à 1,35 Mo** (gzip ~370 Ko), dû à MapLibre. Pas encore de code-splitting. Acceptable pour le MVP, à surveiller si le bundle continue de grossir.
- ~~Aucun test end-to-end front+back~~ **résolu** (commit `90e5f15`, 2026-09-06 19:15) — voir §2/§6. Limite restante : un seul parcours pour l'instant (pas la modération admin ni "Suivre mon trajet"), zéro CI (le suivi GPS n'est de toute façon pas simulable simplement dans ce parcours partagé).
- **Dépendance réseau réelle du test e2e à OpenRouteService** — un flake transitoire (panne réseau ORS de quelques secondes) a été observé une fois pendant la construction du test, résolu de lui-même à la relance. `retries: 0` assumé tant qu'il n'y a pas de CI ; à reconsidérer si une CI est mise en place un jour (voir §9 🟢).
- **Horaires GTFS obsolètes** (flux datant de fin 2021) — si une fonctionnalité d'horaires est envisagée un jour, ne pas se fier à ce flux, chercher une source à jour.

### Contraintes / configurations particulières
- **Port PostgreSQL 5433, pas 5432** sur cette machine (conflit avec un PostgreSQL natif Windows préexistant).
- **Deux `.env` différents pour la DB** (racine = hostname Docker `db`, `backend/.env` = `localhost:5433`) — voir §3.
- **`VITE_API_URL=/api`** nécessite le proxy Vite configuré dans `vite.config.ts` ET une règle équivalente côté reverse proxy en production — ne jamais oublier cette dépendance en déployant.
- **`docker compose up -d` seul ne recharge PAS les variables d'environnement d'un conteneur déjà créé** — utiliser `--force-recreate` après toute modification de `.env` qui doit prendre effet immédiatement, et vérifier avec `docker compose exec <service> printenv <VAR>`.

### Erreurs déjà rencontrées à ne pas reproduire
- Ne jamais `taskkill` un PID trouvé par scan de port sans vérifier son nom de process au préalable.
- Ne jamais considérer `tsc --noEmit` + `vite build` verts comme une preuve qu'une app frontend fonctionne réellement — toujours vérifier en navigateur réel (idéalement piloté, avec captures) avant de déclarer un travail terminé.
- Ne jamais supposer qu'un `.env` correct implique que le conteneur Docker en cours d'exécution le reflète.

---

## 9. Tâches restantes

*(Mise à jour 2026-09-06 17:50, mode autonome — voir §5bis)*

### 🔴 Priorité haute (fonctionnalités essentielles) — **TOUTES FAITES**
- ~~Écran favoris~~ ✅ fait (commit `3494b9e`)
- ~~Écran itinéraire~~ ✅ fait (commit `be04a90`) — intégré au panneau détail d'un arrêt plutôt qu'une page séparée, tracé dessiné sur la carte, 3 profils réels
- ~~Écran signalements~~ ✅ fait (commit `0b30b51`) — formulaire inline dans le panneau détail (3e bouton), page /reports pour la liste
- ~~Écran de modération admin~~ ✅ fait (commit `0c44855`) — filtres par statut, actions Approuver/Rejeter/Résoudre, lien Modération réservé aux admins, testé avec un vrai compte promu ADMIN

**Le périmètre MVP haute priorité est intégralement terminé.** Prochaine étape : §5bis "Suivre mon trajet" puis les items 🟠 ci-dessous, sans attendre de validation (mode autonome, §5bis).

### 🟠 Priorité moyenne (UX/robustesse)
- **Sécurité (audit `npm audit` fait le 2026-09-06 18:35)** : backend a 3 vulnérabilités "high" via `deepmerge-ts` (dépendance transitive de `@prisma/config`, utilisée par la CLI `prisma`, une devDependency). Risque réel jugé faible : ce code n'est jamais exécuté par `node dist/server.js` (le process qui tourne réellement), seulement si quelqu'un invoquait `npx prisma` avec une configuration malveillante — pas un vecteur d'attaque réseau. **Cause racine** : le `Dockerfile` fait `npm install` sans `--omit=dev` dans le build final, donc les devDependencies (dont `prisma` CLI) finissent dans l'image de production. Correctif simple rejeté pour l'instant : `npm audit fix --force` imposerait un downgrade Prisma cassant. Correctif propre (séparer un stage `prod-deps` avec `--omit=dev`) **reporté** car il casserait la commande pratique `docker compose exec backend npm run import:gtfs` (utilise `tsx`, une devDependency) sans plan de remplacement immédiat. Frontend : 0 vulnérabilité.
- ~~"Suivre mon trajet"~~ ✅ fait (commit `96b1f3a`) — voir §5bis
- ~~Tests d'intégration end-to-end front+back~~ ✅ fait (commit `90e5f15`) — 1 parcours critique complet contre les vrais services ; pourrait être étendu (modération admin, suivi GPS) mais couvre déjà le chemin utilisateur le plus courant
- Code-splitting du bundle frontend (MapLibre en chargement différé) si le bundle continue de grossir
- Affichage des tarifs (`TransportLine.fare`) — actuellement toujours `null` (le GTFS JungleBus ne les fournit pas) ; des données réelles existent publiquement (ex. budgetabidjan.com, trouvé pendant la recherche §5bis) — à évaluer comme source d'enrichissement manuel ou via signalements communautaires
- Accessibilité : audit systématique (contrastes, navigation clavier, lecteurs d'écran) — pas encore fait au-delà des `aria-label`/`role` ajoutés au fil de l'eau

### 🟢 Priorité faible
- WebSocket/realtime pour la modération (design esquissé en §4, non implémenté)
- CI/CD (délibérément non prioritaire tant que le MVP n'est pas stabilisé) — la suite e2e (§9 ci-dessus) est prête à y être branchée le jour venu (même prérequis `docker compose up -d` + `npm run dev`)
- Réexaminer le choix ORS si un jour une instance auto-hébergée devient pertinente au volume du projet

### Explicitement écarté (limite honnête, pas un oubli — voir §5bis)
- Position live des véhicules gbaka/woro-woro (aucune source de données, aucune ne semble exister)
- ETA basé sur le trafic routier en direct (aucune source identifiée pour Abidjan)
- Notifications de retard de véhicule (rien à mesurer sans télémétrie)

---

## 10. Prochaine action

**Mode autonome actif (§5bis) : la session enchaîne désormais les tâches de la §9 sans attendre de validation entre chacune**, sauf décision réellement risquée/irréversible.

Ordre exécuté : (1) écran itinéraire ✅, (2) écran signalements ✅, (3) écran modération admin ✅, (4) "Suivre mon trajet" ✅ (2026-09-06 19:00) — **le périmètre MVP haute priorité ET le différenciateur validé par la recherche produit sont tous les deux terminés**. Les deux derniers lots (modération admin, suivi GPS) n'ont révélé aucun bug, ce qui valide que les patterns établis (flex-wrap sans position:absolute, hooks dédiés par domaine, clearWatch systématique) préviennent désormais les classes de bugs déjà rencontrées deux fois chacune en début de projet (voir §5).

Le test e2e critique (2026-09-06 19:15, commit `90e5f15`) clôt la dernière lacune de couverture répétée dans ce fichier. **Prochaine étape à engager** : items 🟠/🟢 restants de §9, dans l'ordre de valeur perçue : (a) accessibilité (audit systématique, pas seulement ad hoc), (b) code-splitting si le bundle continue de grossir (actuellement ~1,35 Mo), (c) tarifs des lignes (source externe à évaluer). Aucune de ces tâches n'est bloquante ni risquée — à enchaîner en mode autonome selon le même protocole (délégation ciblée si pertinent, vérification indépendante systématique — y compris re-vérifier qu'un agent délégué a bien produit des fichiers avant de lire son rapport, voir §5 — navigateur réel avant de déclarer terminé).

---

## 11. Historique des sessions

### Session 1 — 2026-09-05 → 2026-09-06 (Claude Opus 5 / Sonnet 5, alternées)

Audit complet de l'ancien projet `GbakaMaps` (score 3,1/10, voir §7), décision de reconstruction validée par l'utilisateur, puis construction complète de ce nouveau projet du squelette backend jusqu'aux écrans d'authentification frontend (10 commits, voir §6). Deux incidents opérationnels gérés en cours de route (Docker Desktop tué par erreur, conteneur backend connecté à l'ancienne base Neon) — tous deux résolus sans perte de données. Délégation à des agents externes (OpenCode, modèle gratuit `muse-spark-1.3-contributor-free`) testée et validée sur 3 modules/lots (favorites, reports, passe UX, écrans auth), Codex CLI indisponible (quota gratuit épuisé jusqu'au 30/09/2026), Cline CLI mentionné par l'utilisateur mais pas encore essayé. Ce fichier `PROJECT_MEMORY.md` créé à la demande explicite de l'utilisateur à la fin de cette session.

---

## 12. Phase 2 (à partir du 2026-09-06 19:20) — Vision produit, analyse et roadmap au-delà du MVP

**Directive de l'utilisateur** : le MVP étant terminé, la session passe à une phase d'amélioration produit profonde et auto-dirigée — analyse complète du produit, recherche marché/UX/contexte ivoirien réelle, priorisation autonome, implémentation par cycles (observer → rechercher → réfléchir → prioriser → concevoir → implémenter → tester → documenter, en boucle), sans attendre de liste de fonctionnalités de la part de l'utilisateur. Escalade réservée aux choix produit réellement stratégiques.

### 12.1 Analyse à froid du produit actuel (limites identifiées, même sur ce qui "fonctionne")

- **Aucune recherche par nom.** Le backend n'expose que `findNearby` (géospatial) et `findById` — zéro endpoint de recherche textuelle sur `Stop.name` ou les lignes. Le seul moyen de trouver un arrêt est de le repérer visuellement sur la carte et de cliquer son marqueur. C'est l'écart n°1 face à n'importe quelle application de référence (Citymapper/Google Maps/Moovit sont toutes "destination-first" : on tape où on veut aller, la carte suit). Un utilisateur qui connaît le nom de sa destination ("Adjamé Gare") mais pas sa position sur la carte est aujourd'hui bloqué.
- **Écart stratégique le plus important : l'itinéraire ne "prend jamais le gbaka".** `useRoute`/`/api/route` interroge OpenRouteService en point-à-point (marche/vélo/voiture) vers UN SEUL arrêt sélectionné. Le graphe GTFS réel (3 820 arrêts, 391 lignes, correspondances) importé depuis le début du projet n'est **jamais utilisé pour du calcul d'itinéraire** — seulement pour l'affichage sur la carte. Autrement dit, l'application sait où sont les gbaka/woro-woro mais ne dit jamais "prends la ligne 15 jusqu'à Gare Sud, puis change pour la 37" — qui est pourtant la raison d'être du produit. C'est la plus grosse opportunité produit identifiée cette phase (voir 12.3, priorité P0 mais gros chantier, séquencé sur plusieurs cycles).
- **Aucune mémoire de session au-delà des favoris explicites.** Pas de "récemment consultés", pas de suggestion basée sur l'usage réel — chaque session repart de zéro.
- **Aucune tolérance à la connectivité faible/instable**, alors que c'est un scénario explicitement visé (§7 mobile-first) : décision documentée de ne jamais mettre en cache `/api/*` (voir `vite.config.ts`) — cohérente pour éviter des données géospatiales périmées à l'échelle d'une ville, mais rien ne compense pour l'usage hors-ligne ponctuel (relire les infos d'un arrêt déjà visité sans réseau).
- **Tarifs toujours `null`** (déjà documenté §9) — mais maintenant des chiffres réels et datés existent (voir 12.2) pour au moins amorcer un affichage utile.
- **Pas de signal de confiance sur les signalements communautaires** avant modération admin — un report reste "En attente" sans aucun retour à la communauté (ex. "3 autres personnes ont signalé la même chose"), alors que c'est un mécanisme qui a fait ses preuves ailleurs (Waze) pour construire la confiance avant même la modération humaine.
- **Aucun onboarding.** Un nouveau visiteur atterrit directement sur la carte avec une demande de géolocalisation, sans un mot sur ce que l'app permet de faire (favoris, itinéraire, signalement) — pour une audience qui, selon les usages réels observés (12.2), navigue majoritairement de bouche-à-oreille et à l'instinct plutôt qu'avec des apps de transport occidentales.
- **Aucun filtre sur les types d'arrêt affichés** — un utilisateur qui cherche spécifiquement une station de woro-woro voit toujours tous les types mélangés sur la carte, avec seulement une légende passive.

### 12.2 Recherche réelle effectuée (2026-09-06 19:20, sources citées)

**Paysage concurrentiel** : [Gozem](https://gozem.co/bj/en/) — "super-app" de mobilité ouest-africaine (moto-taxi, taxi, livraison), déjà présente au Bénin/Togo/Cameroun — **prévoit son lancement en Côte d'Ivoire fin 2026** ([Ecofin](https://www.agenceecofin.com/finance/1001-72636-la-start-up-gozem-va-etendre-son-offre-de-reservation-en-ligne-de-moyens-de-transports-a-neuf-nouveaux-marches)). Yango et Heetch opèrent déjà à Abidjan (VTC, prix 2 500-4 500 F selon l'heure). **Conséquence produit** : GbakaMap ne doit pas chercher à concurrencer ces VTC premium (réservation de véhicule à la demande) — son terrain reste le transport informel fixe (gbaka/woro-woro/bus), un angle que ni Gozem ni Yango ne couvrent (ils réservent un véhicule dédié, pas n'aident à utiliser un réseau de lignes existant). C'est une différenciation claire à assumer, pas à estomper.

**Tarifs réels 2026** (source : [budgetabidjan.com, mai 2026](https://www.budgetabidjan.com/2026/05/prix-transport-abidjan-2026-budget-reel.html)) : trajet-type Cocody→Plateau — wôrô-wôrô+gbaka combinés ≈ 1 000 F/trajet (500+500), SOTRA bus 200-500 F/ticket, SOTRA bateau-bus 150-500 F, moto-taxi 700-1 500 F, Yango 2 500-4 500 F. Chiffres exploitables comme ordre de grandeur affiché (pas une facturation réelle, un repère budgétaire).

**Plaintes réelles usagers gbaka/woro-woro** (sources : [Fratmat](https://www.fratmat.info/article/232866/economie/transport-urbainbus-gbaka-woro-woro-le-calvaire-quotidien-des-usagers-reportage), [Abidjan.net](https://news.abidjan.net/articles/580327/gbaka-woro-woro-hiace-gnambro-solutions-des-syndicalistes-usagers-et-de-ladministration), [Le Mandat Express](https://www.lemandatexpress.net/2026/05/21/tolerance-zero-sur-les-routes-dabagou-bavettes-genantes-gbaka-et-woro-woro-bientot-dans-le-viseur/)) : surcharge et longues attentes aux gares/stations, anarchie du stationnement (blocage de la circulation), incivisme de conduite, véhicules sans plaque réglementaire ou accessoires dangereux ("dabagou", bavettes traînantes), inquiétude réelle sur les délits de fuite et l'absence d'assurance en cas d'accident. **Conséquence produit** : (a) le temps d'attente réel à un arrêt est une vraie douleur mesurable — opportunité de signalement communautaire léger ("temps d'attente observé"), pas de promesse de données que l'app n'a pas ; (b) les questions d'assurance/responsabilité en cas d'accident relèvent du juridique, **hors périmètre produit** — ne jamais laisser entendre que l'app garantit une quelconque sécurité ou couverture.

**UX transport/offline** (sources : [Moovit blog 2026](https://moovit.com/blog/beyond-the-signal-a-tourists-guide-to-reliable-public-transport-navigation-in-2026/), [LeanCode](https://leancode.co/blog/offline-mobile-app-design)) : les meilleures pratiques confirment (a) mettre les trajets/arrêts fréquents en favoris pour un accès instantané sans repasser par une recherche, (b) mettre en cache les données statiques (topologie GTFS) pour un usage dégradé hors-ligne plutôt que de tout bloquer sans réseau, (c) charger l'essentiel en premier (progressive loading) — un utilisateur mobile abandonne largement au-delà de quelques secondes de chargement.

### 12.3 Roadmap priorisée (P0 = valeur/impact le plus élevé, pas nécessairement le plus urgent à livrer en premier — le séquencement réel tient aussi compte de l'effort)

**P0 — differenciateur stratégique, gros chantier, plusieurs cycles** :
- *Planificateur de trajet multi-modal réel* (marche → arrêt A → ligne X → [correspondance ligne Y] → arrêt B → marche) en s'appuyant sur le graphe GTFS déjà importé (arrêts partageant une ligne, recherche de plus court chemin en nombre de correspondances puis distance). C'est la fonctionnalité qui ferait de GbakaMap un vrai planificateur de transport informel plutôt qu'un annuaire d'arrêts + calculateur d'itinéraire piéton/voiture. Nécessite : modélisation des séquences d'arrêts par ligne (déjà dans le GTFS source, à vérifier si conservé en base), un algorithme de recherche de trajet (Dijkstra/RAPTOR simplifié suffit à l'échelle de 391 lignes), une UI de résultat multi-étapes. **Ne pas se lancer sans une conception dédiée** (prochain cycle) — trop gros pour une implémentation "directe".

**P1 — gains rapides, forte valeur, effort contenu (à livrer ce cycle-ci et les suivants immédiats)** :
1. Recherche textuelle des arrêts (nom d'arrêt, nom de ligne) — corrige l'écart UX le plus visible immédiatement, prérequis naturel du futur planificateur multi-modal.
2. Estimation de coût de trajet (tarifs indicatifs par mode, à partir des chiffres 12.2), affichée à côté du résultat d'itinéraire existant.
3. Filtre par type d'arrêt sur la carte (gbaka/woro-woro/bus/taxi/moto-taxi) — la légende existe déjà visuellement, la rendre interactive.
4. Onboarding minimal (un premier écran ou une infobulle contextuelle au premier lancement, pas un tunnel de slides) expliquant favoris/itinéraire/signalement.

**P2 — valeur réelle mais effort/risque plus élevé, à concevoir avant d'implémenter** :
5. Cache offline des données déjà consultées (arrêts/lignes vus récemment) via IndexedDB/Workbox runtime caching, pour un usage dégradé sans réseau — distinct de la décision existante de ne jamais cacher aveuglément `/api/*` : cache ciblé et explicite, pas un cache générique.
6. Signal de confiance léger sur les signalements ("N personnes ont signalé un problème similaire") avant modération.
7. Historique des trajets récents (pas seulement les favoris explicites).
8. Temps d'attente observé à un arrêt (signalement communautaire dédié, extension du système de reports existant).

**Écarté explicitement** (cohérent avec §5bis, confirmé par cette recherche) : concurrencer les VTC (Gozem/Yango/Heetch) sur la réservation de véhicule à la demande — hors du terrain choisi (transport informel fixe) ; toute fonctionnalité impliquant une garantie de sécurité/assurance (relève du juridique, pas du produit).

### 12.4 Premier cycle engagé

Item P1.1 (recherche textuelle des arrêts) choisi comme premier livrable de cette phase : plus haut ratio valeur/effort, prérequis du futur planificateur (P0), corrige la lacune la plus visible dès la première utilisation. Voir §6 pour le commit correspondant une fois livré.
