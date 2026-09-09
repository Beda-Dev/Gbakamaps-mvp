# PROJECT MEMORY — GbakaMap MVP

> **Règle d'usage** : toute nouvelle session (humaine ou IA) travaillant sur ce projet doit lire ce fichier en premier. Toute session qui termine un travail significatif doit le mettre à jour avant de s'arrêter. Ne jamais y inscrire une hypothèse comme si c'était une décision validée — si ce n'est pas vérifié, l'écrire explicitement comme "à vérifier" ou "supposé, non confirmé".

Dernière mise à jour : **2026-09-06 22:50**, par la session Claude Opus 5 qui a construit ce projet depuis son démarrage.

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
| 2026-09-06 20:00 | `d7ee3cc` | Recherche textuelle des arrêts (`/api/stops/search`, `useStopSearch`, `StopSearchBar`), écrit directement | Backend 61/61, frontend 53/53, vérifié en navigateur réel (recherche→dropdown→sélection→recentrage), premier livrable de la phase 2 "au-delà du MVP" (§12) |
| 2026-09-06 20:15 | `9591a23` | Chaîne de secours routing (ORS clé 1→clé 2→GraphHopper), écrit directement | 64/64 tests backend, bug réel trouvé et corrigé en cours de route (Docker transmet une chaîne vide pour une variable `environment:` non définie, `env.ts` la traitait comme invalide plutôt qu'absente) |
| 2026-09-06 20:30 | `97f6b3e` | Chaîne de secours carte (MapTiler clé 1→clé 2→OSM), écrit directement | Vérifié en navigateur réel avec deux serveurs de dev temporaires et des clés invalides forcées — bascule confirmée par les requêtes réseau réelles à chaque palier (clé 2, puis OSM) |
| 2026-09-06 21:32 | `4b4a504` | Correctif GraphHopper (`vehicle`→`profile`), écrit directement | Trouvé en vérifiant contre la vraie spec OpenAPI officielle (fournie par l'utilisateur) ; re-testé avec la vraie clé, fonctionne réellement |
| 2026-09-06 21:33 | `95a5145` | Planificateur de trajet multi-modal (`GET /api/trip-plan`), GTFS séquence/temps réel, module `lines` (tarif admin), écrit directement | 85/85 tests backend ; deux bugs réels trouvés et corrigés en cours de route (contrainte unique StopLine, mélange de dessertes d'un arrêt hub) ; vitesses de trajet réelles vérifiées physiquement plausibles (13-23 km/h) après correction |
| 2026-09-06 21:35 | `7df22b8` | Filtres mode de transport et ligne sur `/api/stops/nearby`, écrit directement | 6 nouveaux tests, filtres combinables (ET entre type et modes) |
| 2026-09-06 21:40 | `e9d49f3` | Écran "Planifier un trajet" (frontend), écrit directement | 59/59 tests frontend, vérifié en navigateur réel (recherche→sélection→comparaison→5 plans avec icônes de mode, desktop+mobile), suite e2e critique toujours verte |

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
- **Une variable optionnelle listée dans `docker-compose.yml` (`environment:`) mais absente du `.env` arrive comme une CHAÎNE VIDE `""`, pas comme absente** — un schéma Zod `z.string().min(1).optional()` la rejette (présente mais invalide) au lieu de la traiter comme absente. Utiliser une fonction de normalisation (`optionalNonEmpty()` dans `env.ts`) qui convertit `""` en `undefined` avant validation. Rencontré et corrigé le 2026-09-06 (§5, §12.5).
- **Clés de secours (ORS, MapTiler) à ajouter aux DEUX `.env`** si elles doivent être actives à la fois en local (`backend/.env`/`frontend/.env`) ET dans le conteneur Docker (`.env` racine, lu par `docker-compose.yml`) — piège déjà connu (voir ligne ci-dessus sur les deux `.env`), reconfirmé concrètement avec `ORS_API_KEY_2`.

### Erreurs déjà rencontrées à ne pas reproduire
- Ne jamais `taskkill` un PID trouvé par scan de port sans vérifier son nom de process au préalable — utiliser `Get-NetTCPConnection` + `Get-CimInstance Win32_Process` (PowerShell) pour confirmer le PID réel derrière un port avant tout arrêt, surtout si plusieurs serveurs de test tournent sur des ports proches (un conflit de port peut faire dévier un serveur vers un port différent de celui demandé).
- Ne jamais considérer `tsc --noEmit` + `vite build` verts comme une preuve qu'une app frontend fonctionne réellement — toujours vérifier en navigateur réel (idéalement piloté, avec captures) avant de déclarer un travail terminé.
- Ne jamais supposer qu'un `.env` correct implique que le conteneur Docker en cours d'exécution le reflète.
- Ne jamais faire confiance au rapport final d'un agent délégué (OpenCode/Cline) sans vérifier qu'il a réellement produit les fichiers attendus (`git status --short`) — un `exit code 0` ne prouve rien si l'agent a été bloqué en cours de route (ex. permission refusée) et s'est arrêté silencieusement sans finir.

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
- ~~Recherche textuelle des arrêts~~ ✅ fait (commit `d7ee3cc`) — voir §12.4
- ~~Chaîne de secours routing (ORS clé 1→clé 2→GraphHopper)~~ ✅ fait (commit `9591a23`) — voir §12.5
- ~~Chaîne de secours carte (MapTiler clé 1→clé 2→OSM)~~ ✅ fait (commit `97f6b3e`) — voir §12.5
- ~~Recherche et filtres (mode de transport, ligne, rayon)~~ ✅ fait (commit `7df22b8`) — voir §12.7
- ~~Planificateur de trajet multi-modal réel~~ ✅ fait (commits `95a5145`, `e9d49f3`) — voir §12.7. L'écart produit le plus important identifié en phase 2 est comblé : l'app utilise enfin ses lignes gbaka/woro-woro/bus pour calculer un itinéraire, pas seulement les afficher.
- ~~Code-splitting du bundle frontend~~ ✅ fait — voir historique de commits (`React.lazy` par route, 1,36 Mo → 315 Ko de chunk partagé)
- ~~Accessibilité : audit systématique~~ ✅ fait (axe-core, 9 violations réelles → 0)
- ~~Onboarding minimal pour un nouveau visiteur (favoris/itinéraire/signalement/planification expliqués en un coup d'œil)~~ ✅ **fait et committé** par une session peer (commits `f49bdea`, `1d95e69`, `0a0655a`) — bannière dismissible unique `OnboardingBanner` dans `HomePage`, état "vu" mémorisé en localStorage (`gbakamap.onboarding.dismissed`), volontairement pas un tunnel à onglets. Re-vérifié par la session actuelle le 2026-09-08 : suite vitest frontend 91/91 verte + `tsc --noEmit` propre.
- Étendre le planificateur : correspondances via une marche courte entre deux arrêts proches de lignes différentes (aujourd'hui limité au même arrêt physique, §12.7) ; utiliser l'API Matrix ORS (§12.6) pour accélérer le filtrage des candidats — **toujours en attente**

### 🔵 Gros chantiers identifiés, pas encore conçus (voir §12.8)
- ~~Gestion CRUD admin des arrêts~~ ✅ **fait le 2026-09-08** (§12.15) — création/édition/suppression avec impact réel, déplacement par glisser-déposer simple ou multiple. **CRUD des lignes (au-delà du tarif) toujours en attente** — étape 2 du découpage initial, jamais reprise après la disparition de la session déléguée.
- Boussole/orientation de l'appareil (`DeviceOrientationEvent`) pour enrichir "Suivre mon trajet" — **en attente**
- Photos des arrêts (Mapillary ou tags OSM `image=`/`wikimedia_commons=` via Overpass) — pistes réelles, jamais testées empiriquement — **en attente**
- Fonctionnalités IA (Gemini, si l'utilisateur fournit une clé) — pistes non spécifiées (description en langage naturel d'un itinéraire, aide à la modération) — **en attente, aucune clé fournie**
- ~~Recherche de lieux nommés quelconques via Overpass~~ ✅ fait (§12.7bis) + ~~POI à proximité~~ ✅ + ~~quartiers/communes~~ ✅ (§12.13/§12.14)

### 🟢 Priorité faible
- WebSocket/realtime pour la modération (design esquissé en §4, non implémenté)
- CI/CD (délibérément non prioritaire tant que le MVP n'est pas stabilisé) — la suite e2e (§9 ci-dessus) est prête à y être branchée le jour venu (même prérequis `docker compose up -d` + `npm run dev`)
- Réexaminer le choix ORS si un jour une instance auto-hébergée devient pertinente au volume du projet
- Isochrones ORS (§12.6) — piste identifiée, pas encore de design produit

### Explicitement écarté (limite honnête, pas un oubli — voir §5bis)
- Position live des véhicules gbaka/woro-woro (aucune source de données, aucune ne semble exister)
- ETA basé sur le trafic routier en direct (aucune source identifiée pour Abidjan)
- Notifications de retard de véhicule (rien à mesurer sans télémétrie)

---

## 10. Prochaine action

**Mode autonome actif (§5bis) : la session enchaîne désormais les tâches de la §9 sans attendre de validation entre chacune**, sauf décision réellement risquée/irréversible.

Ordre exécuté : (1) écran itinéraire ✅, (2) écran signalements ✅, (3) écran modération admin ✅, (4) "Suivre mon trajet" ✅ (2026-09-06 19:00) — **le périmètre MVP haute priorité ET le différenciateur validé par la recherche produit sont tous les deux terminés**. Les deux derniers lots (modération admin, suivi GPS) n'ont révélé aucun bug, ce qui valide que les patterns établis (flex-wrap sans position:absolute, hooks dédiés par domaine, clearWatch systématique) préviennent désormais les classes de bugs déjà rencontrées deux fois chacune en début de projet (voir §5).

Le test e2e critique (2026-09-06 19:15, commit `90e5f15`) clôt la dernière lacune de couverture répétée dans ce fichier.

**Phase 2 (§12)** : recherche produit réelle effectuée (analyse à froid du produit + recherche marché/UX/contexte ivoirien avec sources), roadmap priorisée P0/P1/P2 écrite, puis livrée intégralement dans ce même cycle (2026-09-06 20:00-21:45) suite à une demande utilisateur très détaillée reprenant et dépassant l'ambition de l'ancien projet GbakaMaps :
1. Recherche textuelle des arrêts (P1.1, commit `d7ee3cc`).
2. Chaînes de secours multi-fournisseurs — routing (`9591a23`) et carte (`97f6b3e`) — suite à un incident réel de rate-limit ORS pendant les tests, toutes deux vérifiées en conditions réelles (§12.5).
3. Correctif GraphHopper (`4b4a504`) trouvé en vérifiant contre la vraie spec API fournie par l'utilisateur.
4. **Le planificateur multi-modal réel (P0, l'écart stratégique le plus important du projet)** livré en entier : topologie GTFS ordonnée par sens (prérequis corrigé), deux bugs réels trouvés et corrigés pendant le développement (contrainte unique StopLine, mélange de dessertes d'un hub), modèle de tarif revu en cours de route sur demande explicite de l'utilisateur (admin fait foi, jamais une valeur inventée dans le code), backend (`95a5145`) et frontend (`e9d49f3`) tous deux livrés et vérifiés en navigateur réel.
5. Filtres de recherche (mode de transport, ligne) sur `/stops/nearby` (`7df22b8`).

**Le périmètre MVP ET tous les items P0/P1 de la phase 2 sont désormais terminés.** Idées réelles non encore construites, à ne pas oublier : voir §12.8 (CRUD admin complet — demandé explicitement —, boussole, photos d'arrêts, IA Gemini, recherche de lieux via Overpass).

**Prochaine étape à engager** : items 🟠/🔵/🟢 restants de §9, dans l'ordre suggéré : (a) accessibilité et code-splitting (gains rapides) ; (b) concevoir puis construire la gestion CRUD admin complète (🔵, demande explicite de l'utilisateur, nécessite une conception des entités/actions/garde-fous avant implémentation) ; (c) étendre le planificateur aux correspondances par marche courte. Aucune de ces tâches n'est bloquante ni risquée — à enchaîner en mode autonome selon le même protocole (vérification indépendante systématique, navigateur réel avant de déclarer terminé).

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

### 12.4 Premier cycle engagé — ✅ recherche textuelle des arrêts (P1.1)

Item P1.1 livré (2026-09-06 20:00, commit `d7ee3cc`) : plus haut ratio valeur/effort, prérequis du futur planificateur (P0), corrige la lacune la plus visible dès la première utilisation. `GET /api/stops/search`, hook `useStopSearch` (debounce), composant `StopSearchBar` en overlay flottant. Vérifié en navigateur réel (recherche → dropdown → sélection → recentrage + panneau détail), desktop et mobile, aucun chevauchement avec les autres contrôles de carte.

### 12.5 Résilience réseau — chaînes de secours multi-fournisseurs (2026-09-06 20:00-20:45)

**Déclencheur** : pendant la vérification de la recherche textuelle, la suite e2e a échoué 3 fois de suite sur l'étape itinéraire avec "Service de calcul d'itinéraire indisponible" (`fetch failed`), alors que des appels `curl` isolés juste après réussissaient systématiquement. Diagnostic : limite de débit ORS **par minute** (pas un incident, pas le quota journalier) déclenchée par mes propres tests automatisés répétés en rafale. L'utilisateur a alors demandé explicitement un système de secours généralisé à toutes les ressources externes du projet, pour qu'aucune ne puisse jamais bloquer l'application.

**Implémenté** :
- **Routing** (commit `9591a23`) : `ORS_API_KEY` → `ORS_API_KEY_2` (si configurée) → GraphHopper (si `GRAPHHOPPER_API_KEY` configurée) → erreur claire agrégée. GraphHopper choisi après recherche réelle (voir §12.6) car il distingue réellement les profils voiture/vélo/marche — OSRM démo, lui, reste explicitement écarté même comme dernier recours malgré sa disponibilité sans clé : un résultat rapide mais trompeur est pire qu'un échec honnête, principe déjà établi lors du remplacement initial d'OSRM (§4).
- **Carte** (commit `97f6b3e`) : `VITE_MAPTILER_KEY` → `VITE_MAPTILER_KEY_2` (si configurée) → repli OSM déjà existant. Bascule déclenchée par un vrai événement d'échec MapLibre (`AJAXError` ciblant `api.maptiler.com`), jamais par supposition.
- **GTFS** : aucun changement — c'est un script d'import batch hors ligne, jamais dans le chemin d'une requête utilisateur (décision déjà documentée §3), donc pas concerné par un besoin de repli en direct.

**Bug réel trouvé et corrigé pendant l'implémentation** : Docker Compose transmet une variable listée dans `environment:` du service comme une **chaîne vide** quand elle est absente du `.env` ("Defaulting to a blank string"), pas comme une variable absente. Le conteneur backend est entré en crash-loop dès l'ajout de `GRAPHHOPPER_API_KEY` à `docker-compose.yml` sans valeur dans `.env` racine (`z.string().min(1).optional()` rejette `""` comme "présente mais invalide" au lieu de la traiter comme absente). Corrigé par une fonction `optionalNonEmpty()` dans `env.ts` qui normalise `""` en `undefined` avant validation — testé (`backend/tests/env.test.ts`, 3 tests).

**Autre piège rencontré (déjà connu, reconfirmé)** : `ORS_API_KEY_2` ajoutée par l'utilisateur dans `backend/.env` (utilisé par `npm run dev`/tests locaux) ne suffisait pas à activer le repli dans le conteneur Docker — `docker-compose.yml` lit le `.env` **racine**, pas `backend/.env` (piège déjà documenté §8, reconfirmé ici en pratique). La clé a dû être ajoutée aux deux fichiers.

**Vérification réelle** (pas seulement lecture de code) : 64/64 tests backend (dont les nouveaux tests de repli et de régression `""`), conteneur Docker reconstruit et confirmé stable (`docker compose ps`, plusieurs vérifications espacées dans le temps — ne redémarre plus en boucle), itinéraire réel fonctionnel après reconstruction. Côté carte : **deux serveurs de dev temporaires lancés avec des clés MapTiler invalides forcées** pour observer la bascule en conditions réelles — (1) clé 1 invalide + clé 2 valide → bascule confirmée par les requêtes réseau réelles vers MapTiler (changement de clé visible), carte intacte, 100 marqueurs rendus ; (2) les deux clés invalides → repli OSM confirmé visuellement (captures d'écran), sélecteur de style disparu comme attendu. Suite e2e re-testée après coup : verte (1m10s, contre les vrais services).

**Leçon opérationnelle ajoutée** : avant tout `taskkill`/arrêt de process lancé pour un test temporaire (ici deux serveurs Vite sur des ports alternatifs), toujours vérifier le PID réel via `Get-NetTCPConnection` + `Get-CimInstance Win32_Process` (PowerShell) plutôt que de faire confiance à l'ordre de lancement des commandes — un conflit de port peut faire dévier un serveur vers un port différent de celui demandé (`--port 5175` s'est retrouvé sur 5176 car 5175 était déjà pris par un serveur de test précédent), et un `pkill`/`taskkill` par port supposé peut viser le mauvais process. Cohérent avec la règle déjà établie après l'incident Docker Desktop (§5).

### 12.6 Recherche réelle effectuée (2026-09-06 20:35) — API OpenRouteService, capacités au-delà du routage point-à-point

Sources : [documentation officielle openrouteservice.org/services](https://openrouteservice.org/services/), [référence endpoints GIScience](https://giscience.github.io/openrouteservice/api-reference/endpoints/).

**Services disponibles chez ORS au-delà de `/v2/directions/` (déjà utilisé)** : Isochrones (zone atteignable en X minutes/km depuis un point), Matrix (temps/distance entre plusieurs origines et destinations en un seul appel), Geocoding/autocomplete (via Pelias), POI (points d'intérêt), Elevation.

**Opportunités produit identifiées, pas encore implémentées** :
- **Matrix** : pertinence directe pour le futur planificateur multi-modal (P0, §12.3) — au lieu d'appeler `/directions` une fois par arrêt candidat pour trouver le plus proche accessible à pied, un seul appel Matrix donne la distance/durée de marche vers TOUS les arrêts proches d'un coup. Réduirait aussi la consommation de quota (moins d'appels) — pertinent après l'incident de rate-limit de cette session.
- **Isochrones** : différenciateur UX plausible ("tout ce qui est accessible en 15 min à pied/en gbaka depuis chez moi") — pas dans le périmètre GTFS actuel (topologie de lignes, pas de calcul de zone), mais complémentaire.
- **Geocoding** : notre recherche actuelle (§12.4) ne trouve que des arrêts/lignes connus de la base, pas une adresse quelconque ("Rue X, Cocody"). Pourrait compléter `StopSearchBar` pour permettre un point de départ/arrivée libre, pas seulement un arrêt.
- **Elevation** : peu pertinent pour Abidjan (relief globalement plat en zone urbaine) — écarté.

**Statut** : recherche faite, aucune implémentation pour l'instant — ces pistes rejoignent la roadmap §12.3 (P0/P2) plutôt que d'être ajoutées de façon ad hoc.

### 12.7 Planificateur multi-modal réel livré (2026-09-06 20:45-21:45) — l'écart stratégique P0 est comblé

Suite à une demande explicite et détaillée de l'utilisateur ("reprends l'ambition initiale de GbakaMaps mais en mieux") reprenant et dépassant l'objectif P0 identifié en §12.3, le planificateur multi-modal a été conçu et livré dans ce cycle, avec plusieurs découvertes et corrections en cours de route.

**Prérequis data corrigé** : `StopLine.sequence`/`direction` existaient dans le schéma depuis le début du projet mais étaient à **0% remplis** — l'import ne captait que l'ensemble des arrêts d'une ligne, jamais leur ordre. Or les fichiers GTFS sources (`stop_times.txt`, `trips.txt`) contiennent bien `stop_sequence`/`direction_id`/`trip_headsign` — `import-gtfs.ts` réécrit pour les exploiter via un "voyage représentatif" par (ligne, sens). Résultat : 98,3% des dessertes (10183/10357) ont désormais un ordre réel et un temps relatif entre arrêts (`secondsFromRouteStart`, écart GTFS 2021 — jamais l'horaire absolu).

**Deux bugs de modèle/algorithme trouvés PENDANT le développement (pas en théorie)** :
1. La contrainte unique `[stopId, lineId]` ne permettait qu'UNE seule ligne stockée par arrêt — or un arrêt terminus/hub peut appartenir aux DEUX sens d'une même ligne avec des arrêts **entièrement différents** entre les deux sens (vérifié empiriquement : 0 arrêt commun sur 31+31 testés, pas une supposition). Le second sens importé écrasait silencieusement le premier. Corrigé en ajoutant `direction` à la contrainte d'unicité (140 arrêts partagés entre les deux sens sur l'ensemble du réseau, tous préservés après correction).
2. Un arrêt hub desservi par plusieurs lignes (ex. "Cash Center Plateau", 29 lignes réelles) voyait ses dessertes atteignables mélangées entre lignes sans rapport lors de la recherche de correspondances — un premier test réel a produit un plan affichant une "ligne 25" reliant deux arrêts n'appartenant pourtant pas à la même ligne, avec une vitesse résultante de **522 km/h**. Corrigé en indexant les résultats par (arrêt, ligne, sens) plutôt que par arrêt seul. Après correction, toutes les vitesses observées sur des trajets réels sont redevenues physiquement plausibles (13-23 km/h, cohérent avec un bus/gbaka en circulation urbaine dense).

**Décision produit sur le coût, changée en cours de session par l'utilisateur** : le plan initial prévoyait un tableau de tarifs indicatifs codés en dur par mode de transport. L'utilisateur a explicitement demandé que ce soit plutôt **l'administrateur** qui définisse les tarifs réels. Redesign : `TransportLine.fare` (déjà dans le schéma, toujours `null` jusqu'ici) fait foi ; nouveau champ `fareVerified` (booléen) distingue une valeur indicative pré-remplie à l'import (tarifs 2026 réels recherchés, §12.2 : bus 200F — l'utilisateur a précisé que le tarif bus réel est 200 OU 500 F selon la ligne, 200 retenu comme valeur de départ la plus courante ; gbaka 250F ; wôrô-wôrô 500F) d'une valeur confirmée par un administrateur. Nouveau module `lines` : `GET /api/lines(/:id)` public, `PATCH /api/admin/lines/:id` (admin uniquement) pour corriger le vrai tarif — l'import ne touche plus jamais une ligne une fois `fareVerified=true`. TAXI/MOTO_TAXI n'apparaissent jamais comme type de LIGNE dans les données GTFS (ce sont des stations, pas des trajets fixes), donc hors de portée de ce mécanisme.

**GraphHopper — bug trouvé en vérifiant contre la vraie doc** : l'utilisateur a fourni le fichier `openapi.json` officiel de GraphHopper (référence tierce, jamais commitée — voir `.gitignore`). Vérification faite (comme la règle l'exige pour tout service externe) : le paramètre de requête réel est `profile` (valeurs `car`/`bike`/`foot`), pas `vehicle` (nom d'une version antérieure de leur API) utilisé par erreur lors de l'implémentation initiale du repli routing (§12.5). Corrigé et re-testé avec la vraie clé de l'utilisateur contre `graphhopper.com/api/1/route` — fonctionne réellement.

**Portée assumée de cette V1** (documentée dans le code, pas cachée) : trajets directs et à 1 correspondance maximum, correspondance limitée à un changement au même arrêt physique (pas de marche entre deux arrêts proches de lignes différentes — amélioration possible via l'API Matrix ORS, §12.6), temps de marche estimé par une vitesse standard (5 km/h + facteur de détour 1,3, valeurs usuelles de planification piétonne, pas mesurées à Abidjan) plutôt que des appels OpenRouteService par candidat (évite de multiplier les appels externes après l'incident de rate-limit ORS, §12.5).

**Filtres de recherche ajoutés** (demande explicite, §12.3 "Recherche et filtres") : `GET /api/stops/nearby` accepte désormais `modes=gbaka,woroworo,taxi,mototaxi` (liste, sémantique OU, sur les booléens réels de `Stop` — indépendants de `stopType` qui ne retient qu'un mode dominant à l'affichage) et `lineId=<uuid>` (ne retient que les arrêts desservis par une ligne précise). Combinable avec `type` (ET logique).

**Frontend** : nouvelle page `/planifier` — origine (recherche ou géolocalisation réelle) → destination (recherche) → filtres (rayon de marche 500m/1km/2km/5km, critère d'optimisation le plus rapide/moins cher/moins de marche) → liste de plans classés, premier marqué "Recommandé", détail des étapes avec icônes réelles par mode (bus pour BUS/GBAKA, taxi partagé pour WORO_WORO — nouvelles icônes `BusIcon`/`CarTaxiFrontIcon`, Lucide, licence documentée) et étiquettes explicites "(estimé)" partout où une donnée n'est pas vérifiée. Lien "Planifier un trajet" visible que l'utilisateur soit connecté ou non (fonctionnalité publique).

**Vérifié réellement** : 85 tests backend (dont 13 nouveaux tests trip-planning avec une topologie de lignes semée explicitement et des coordonnées isolées géographiquement pour ne pas polluer les assertions avec les vraies données GTFS déjà en base — piège de test rencontré et corrigé pendant l'écriture des tests, voir §5 style), 7 nouveaux tests lines, 59 tests frontend (dont 6 nouveaux useTripPlan), suite e2e critique toujours verte après tout ce chantier, ET un parcours complet en navigateur réel (recherche origine/destination, sélection, comparaison, 5 plans réels affichés avec icônes de mode, changement de critère fonctionnel, desktop + mobile).

### 12.8 Pistes réelles identifiées pendant les échanges, pas encore implémentées (à ne pas oublier)

Notées explicitement à la demande de l'utilisateur ("tu fais vraiment les notes ?") — ce sont des idées réelles évoquées en conversation :

- **Gestion CRUD admin** (demande explicite, confirmée deux fois par l'utilisateur, "je le veux aussi, garde ça en tête") : arrêts ✅ **fait le 2026-09-08** (§12.15, backend + écran + glisser-déposer). **Lignes (au-delà du tarif) toujours en attente** — étape 2 du découpage initial jamais reprise.
- **Boussole / orientation de l'appareil** (`DeviceOrientationEvent`) pour "Suivre mon trajet" — ferait pivoter la carte selon le cap réel du téléphone, ou afficherait une flèche vers le prochain arrêt. Techniquement faisable, contraintes réelles connues (HTTPS requis, permission explicite requise sur iOS 13+ via clic utilisateur). **Toujours en attente.**
- **Photos des arrêts** — Mapillary (couverture réelle à Abidjan incertaine) ou tags OSM `image=`/`wikimedia_commons=` via Overpass (rares sur de simples arrêts). **Toujours en attente**, jamais testé empiriquement.
- ~~Points d'intérêt à proximité d'un arrêt~~ ✅ **fait** (§12.13, section "Aux alentours" du panneau détail).
- ~~Limites de quartiers sur la carte~~ ✅ **fait** (§12.13 étiquettes + §12.14 vrais contours de commune).
- **Fonctionnalités IA (Gemini)** — l'utilisateur a proposé d'ajouter une clé API Gemini si une fonctionnalité IA s'avérait utile (description en langage naturel d'un itinéraire, aide à la modération). Aucune décision prise. **Toujours en attente.**
- ~~Recherche de lieux quelconques via Overpass~~ ✅ **fait** le 2026-09-06 (commit `36d6032` backend, `a764591` frontend) — voir §12.7bis.

### 12.7bis Recherche de lieux (Overpass) + cohérence multi-sources — livré le 2026-09-06 22:50

Suite directe de la piste Overpass "geocoding" (§12.6/§12.8) et d'une demande explicite de l'utilisateur ("on peut faire des recherches par lieu, pas uniquement arrêt, comme Google Maps ?").

**Vérification empirique avant adoption** (comme à chaque nouvel usage d'un service déjà connu du projet) : Overpass avait déjà été écarté au tout début du projet pour les tags de transport informel (`gbaka=yes`, quasi aucun résultat, §4/§7) — un usage DIFFÉRENT, la recherche de lieux nommés génériques, a été testé séparément et fonctionne réellement bien pour Abidjan. Deux problèmes réels trouvés en testant (pas supposés) : (1) un header `User-Agent` explicite est obligatoire (406 sans lui) ; (2) une requête `nwr` sur toute la Côte d'Ivoire renvoie 200 mais VIDE (timeout silencieux côté serveur) — corrigé en utilisant `node` seul (les POI nommés, l'essentiel des résultats utiles) sur une bbox resserrée au Grand Abidjan, cohérente avec la couverture réelle de nos données GTFS.

**Cohérence entre sources de données — demande explicite et très détaillée de l'utilisateur** (fusion/normalisation/matching, "ne jamais inventer une correspondance", "exactitude > quantité de données") : un lieu Overpass peut désigner la même entité réelle qu'un arrêt déjà connu de notre base GTFS (même quartier/gare, deux sources différentes). Le système ne les fusionne QUE si DEUX signaux concordent à la fois — proximité géographique (≤60m) ET nom correspondant après normalisation (`backend/src/common/normalize.ts` : accents/casse/ponctuation uniformisés, **jamais** de correspondance floue par distance d'édition, qui risquerait un faux rapprochement). Si un seul des deux signaux est présent, les deux entités restent distinctes — jamais fusionnées à tort. Testé avec un scénario à 3 arrêts (un vraiment correspondant, un proche mais mal nommé, un bien nommé mais loin) : seul le premier est identifié comme la même entité.

**État de conformité au principe demandé, honnêtement évalué** :
- ✅ **Le planificateur de trajet (§12.7) respecte déjà ce principe structurellement**, sans changement nécessaire : chaque étape "ride" d'un plan ne relie deux arrêts QUE s'il existe une vraie ligne `StopLine` (lineId+direction+séquence) les reliant dans le bon sens — jamais une association basée sur la seule proximité géographique. La SEULE proximité géographique utilisée est légitime : trouver les arrêts EMBARCABLES à pied près de l'origine/destination (c'est la bonne façon de faire, pas un raccourci risqué). La simplification déjà documentée (correspondance limitée au même arrêt physique, §12.7) est une conséquence DIRECTE de ce principe : étendre les correspondances à une marche courte entre deux arrêts proches mais distincts nécessiterait exactement le même genre de score de confiance (distance + compatibilité) que celui maintenant implémenté pour places/stops — à réutiliser le jour où cette extension sera construite.
- ✅ **La recherche de lieux (nouveau)** applique maintenant ce même principe (proximité ET nom, jamais un seul signal).
- ⚠️ **Pas encore concerné, car pas encore un problème réel** : les arrêts/lignes eux-mêmes n'ont aujourd'hui qu'UNE SEULE source (GTFS JungleBus) — il n'existe actuellement aucune situation où deux sources différentes décrivent le même arrêt/la même ligne avec des noms différents (le scénario "Abobo Gare" vs "Abobo-Gare" donné en exemple par l'utilisateur est actuellement hypothétique pour les arrêts/lignes, pas un bug vécu). Le mécanisme de normalisation (`normalizeName`/`namesLikelyMatch`) est déjà écrit et réutilisable si une seconde source d'arrêts/lignes est ajoutée un jour (ex. un second flux GTFS, des arrêts communautaires vérifiés contre OSM) — **ne pas re-largement inventer un dispositif ce jour-là, réutiliser celui-ci**.
- ⚠️ **Duplication communauté vs OSM** : un arrêt créé via signalement communautaire (`Stop.source=COMMUNITY`) pourrait en théorie dupliquer un arrêt déjà importé d'OSM (`source=OSM`) au même endroit. Aucune preuve qu'un doublon existe réellement à ce jour — pas un bug corrigé, une vigilance à garder (le mécanisme de matching ci-dessus pourrait être réutilisé ici aussi si un vrai doublon était rapporté).

### 12.9 Sélection origine/destination par clic + trajet dessiné sur la carte — livré le 2026-09-06 23:00

Deux demandes explicites de l'utilisateur. `StopsMap.tsx` gagne `onMapClick`/`pickerActive` (curseur crosshair), `originMarker`/`destinationMarker` (couleurs vert/rouge réservées, jamais confondues avec les couleurs réelles des types d'arrêts) et `tripSegments` (couche GeoJSON séparée du tracé point-à-point existant, stylée par type : marche = pointillé, trajet en ligne = trait plein coloré par `line.color`). `TripPlannerPage.tsx` affiche désormais une carte à côté du formulaire (empilée dessous en mobile) ; un bouton viseur sur chaque champ active la sélection par clic ; `buildTripSegments()` reconstruit les segments du plan actuellement déplié à partir des coordonnées réelles (origine/destination + arrêts de montée/descente de chaque étape).

**Honnêteté du tracé** : aucune géométrie de voirie (GTFS `shapes.txt`) n'existe dans les données JungleBus importées (déjà confirmé absent, §12.7bis/§7) — les segments dessinés sont des lignes droites entre points réels, jamais un tracé de rue exact. Un avertissement explicite est affiché sous la carte quand un trajet est dessiné, pour ne jamais laisser croire à une précision qu'on n'a pas.

Vérifié par test navigateur réel (Playwright) : clic sur le viseur → curseur change → clic sur la carte → marqueur posé aux vraies coordonnées cliquées → comparaison retourne un vrai plan (Plateau, Abidjan, ligne 206) → tracé affiché correctement (capture d'écran inspectée visuellement).

### 12.10 PWA arrière-plan — limite de plateforme documentée (question utilisateur du 2026-09-06)

L'utilisateur a demandé si une PWA peut tourner en arrière-plan comme une app mobile native (icône persistante dans la barre de notifs façon service Android, suivi de position après fermeture de l'app). Réponse vérifiée (connaissance des specs, pas testé empiriquement dans ce projet) :
- **Possible** : Push API + Service Worker (notifications même app fermée), Background Sync (rattraper une action différée), Periodic Background Sync (rafraîchissement périodique — Chrome/Android seulement, très restreint, pas garanti).
- **Impossible** : suivi GPS continu en arrière-plan (`watchPosition` s'arrête hors premier plan sur la plupart des navigateurs mobiles, et totalement sur iOS), icône de notification persistante façon `ForegroundService` Android (capacité native uniquement, pas exposée aux PWA). iOS en particulier restreint fortement tout le reste (Push web récent avec limites, pas de Background/Periodic Sync).
- **Implication pour GbakaMap** : le Push API est la bonne piste si on veut alerter l'utilisateur app fermée (arrêt proche, ligne perturbée) — mais le "suivre mon trajet en direct après avoir quitté l'app" restera impossible en PWA ; il faudrait une app native pour ça. À ne pas re-proposer comme faisable plus tard.

### 12.11 Décongestion de la carte par zoom (clustering) + panneau détail enrichi — livré le 2026-09-06 23:15

Demande explicite de l'utilisateur (clarté cartographique : chaque élément visible/distinguable/sélectionnable, décongestion intelligente selon le zoom). Les arrêts de `StopsMap.tsx` (carte principale) sont passés de Markers DOM individuels (illisible dès que la zone est dense, ex. Plateau) à une source GeoJSON groupée (clustering natif MapLibre/supercluster, `clusterRadius` 45px, `clusterMaxZoom` 16) : cercles numérotés là où les arrêts sont proches, éclatement progressif au clic (zoom via `getClusterExpansionZoom`), points individuels colorés par type une fois assez zoomé (expression MapLibre `match` dérivée de `STOP_TYPE_COLORS`, un seul endroit à maintenir avec la légende).

`HomePage.tsx` : panneau détail enrichi (type en libellé humain, distance réelle depuis la position utilisateur si connue, libellé explicite "Correspondance possible entre N lignes" au lieu d'une simple liste).

**Un vrai piège rencontré en testant** : dans l'environnement de test (rendu logiciel SwiftShader, headless), le chargement du GeoJSON groupé prend plusieurs secondes (`isSourceLoaded` reste `false` un moment) — une capture d'écran prise trop tôt montrait une carte vide, laissant croire à un bug. Confirmé par accès direct à l'instance MapLibre (`queryRenderedFeatures`, écoute de `sourcedata`) que ce n'est qu'une lenteur d'environnement de test, pas un défaut de l'app : les données finissent par charger et s'afficher correctement, clic sur un point réel confirmé fonctionnel (panneau détail avec les vraies données, ex. "Djekanou", Gbaka, correspondance entre 2 lignes réelles).

### 12.12 CRUD admin délégué à une session peer (Cline/OpenCode) — 2026-09-06 23:35

L'utilisateur a rappelé explicitement pouvoir déléguer du travail à des agents peer (Cline/OpenCode). Le **CRUD admin complet** (Stops + TransportLine, confirmé deux fois par l'utilisateur, jusque-là seulement `PATCH /api/admin/lines/:id` côté backend, jamais d'écran) a été délégué à la session peer `gbakamaps-10` le 2026-09-06, avec consigne de lire ce fichier d'abord, suivre les conventions du repo (modules `*.schemas/*.service/*.routes`, `requireAdmin`, hooks TanStack Query façon `useAdminReports.ts`), écrire des tests, committer par petites étapes, et faire un point de sync avant d'avancer trop loin. **État au moment de cette note : en attente de sa réponse** — voir aussi la mémoire persistante `delegation-cline-opencode.md` pour le suivi inter-session. Ne pas reconstruire ce chantier en parallèle sans vérifier d'abord où en est cette délégation.

### 12.13 POI à proximité + quartiers (Overpass) + cercle de rayon sur la carte — livré le 2026-09-06 23:45

Trois demandes explicites. `GET /api/places/nearby` (POI réels autour d'un point — pharmacie, école, marché... — liste blanche `POI_CATEGORIES` étendue à la demande de l'utilisateur, chaque nouvelle catégorie vérifiée empiriquement avant ajout) et `GET /api/places/neighborhoods` (quartiers du Grand Abidjan, `place=suburb|neighbourhood|quarter`, `nwr` nécessaire ici car souvent des relations/ways — vérifié rapide sur la bbox déjà resserrée) complètent le module places. Ces deux endpoints ne sont pour l'instant PAS encore branchés côté frontend (pas de panneau "POI à proximité" sur le détail d'un arrêt, pas de labels de quartiers sur la carte) — l'intégration UI reste à faire, seule la donnée backend est prête et testée.

Le cercle de rayon (bouton viseur sur la carte principale, `radiusCircleMeters` sur `StopsMap`) matérialise le rayon de recherche actuel avec un vrai cercle terrestre (pas une ellipse en degrés qui déformerait aux latitudes élevées) — demande explicite ("un cercle sur la carte qui montre vraiment le rayon"), livré et vérifié visuellement.

**Flakiness réseau documentée** : sous charge de test concurrente (plusieurs suites appelant Overpass en parallèle), certains tests réels ont timeouté/reçu des 406 (rate-limiting côté Overpass, pas un bug de code — les mêmes tests passent systématiquement en isolation). Timeouts portés à 25s sur les tests places réseau. Si cette flakiness devient gênante en CI, envisager un cache/backoff côté service plutôt que des mocks (qui iraient à l'encontre de la philosophie "tester contre le vrai service" du projet).

**Suite (même jour, branchement frontend)** : `useNearbyPois`/`useNeighborhoods` (nouveaux hooks) + section "Aux alentours" du panneau détail d'un arrêt + toggle "quartiers" sur la carte principale — les deux endpoints backend sont maintenant réellement utilisés côté UI, plus seulement testés en isolation.

**⚠️ Piège d'environnement réel rencontré et à retenir** : le backend tourne en Docker via une image construite au build (`backend/Dockerfile`, pas de volume monté sur `src/` en conditions d'usage normales de ce projet) — ajouter une route côté code source ne la rend PAS disponible sur `localhost:4000` tant que l'image n'est pas reconstruite. Les tests `vitest` du backend ne détectent JAMAIS ce décalage (ils importent `buildApp()` directement en Node, sans passer par Docker) — seul un test en conditions réelles contre le serveur réellement utilisé par le frontend (navigateur réel, `curl` sur le port exposé) le révèle. Trouvé concrètement le 2026-09-06 : `/api/places/nearby` et `/api/places/neighborhoods` renvoyaient un vrai 404 en navigateur alors que 101/101 tests backend passaient. **Réflexe à prendre systématiquement après tout ajout de route backend** : `docker compose up -d --build backend` avant de valider une fonctionnalité en test navigateur, jamais supposer que le serveur Docker est à jour juste parce que les tests unitaires passent.

### 12.14 Limites réelles de commune + recherche directe par commune — livré le 2026-09-07

Suite directe de §12.13 (quartiers en points). L'utilisateur a demandé si Overpass permet de délimiter de vraies communes (pas juste des points) et de chercher directement par commune. Vérifié empiriquement avant implémentation : les communes du Grand Abidjan (Cocody, Le Plateau, Treichville, Marcory, Koumassi, Attécoubé...) existent comme relations OSM `boundary=administrative`/`admin_level=8`, avec une géométrie réelle reconstructible — testé sur Cocody, 22 segments de voie "outer" correctement assemblés en un anneau fermé de 192 points via un algorithme de chaînage sur points d'extrémité partagés (`assembleRingsFromOuterWays`, best-effort documenté comme tel, pas une vraie librairie GIS).

`GET /api/places/communes` (q optionnel) livré et testé (Overpass réel). Côté frontend : `useCommunes`/`useCommuneSearch`, nouvelle couche polygone sur `StopsMap` (couleur déterministe par nom, pas de palette figée à maintenir), `StopSearchBar` combine désormais arrêts + communes (même principe de distinction visuelle que `TripPlannerPage.PlaceField`), sélectionner une commune cadre la carte sur son étendue réelle (`focusBounds`/`fitBounds`) et révèle son contour.

**⚠️ Découverte de coordination importante (2026-09-07)** : la session déléguée pour le CRUD admin (`gbakamaps-10`, §12.12) travaille dans le **même répertoire de travail Git** que cette session — pas un worktree séparé. Ses modifications au CRUD arrêts (`stops.routes/schemas/service.ts`, `tests/admin-stops.test.ts`) sont apparues **stagées mais non committées** dans l'index partagé pendant que cette session avait ses propres modifications non stagées sur d'autres fichiers. Commit fait avec précaution via `git commit -- <fichiers précis>` (jamais `git commit -a` ni `git add .` dans ce contexte) pour committer uniquement le travail de cette session sans toucher à l'index de l'autre session ni le committer prématurément à sa place. **Règle à retenir tant que des sessions travaillent en parallèle sur le même repo** : toujours committer par chemins explicites, jamais en masse, et vérifier `git status` avant tout commit pour repérer du contenu déjà stagé par ailleurs.

Aussi trouvé pendant cette session : `gbakamaps-10` a identifié et corrigé une régression réelle non liée à sa tâche — l'index spatial GiST `stops_geog_idx` avait été supprimé sans jamais être recréé par la migration `20260906205221_add_stopline_route_timing` (Prisma ne peut pas déclarer un index sur un type `Unsupported` comme `geography`, donc tout `prisma migrate dev` le supprime silencieusement). Corrigé en commit séparé (`e5b43ad`) avec un commentaire expliquant pourquoi Prisma le re-supprimera si on n'y prend pas garde. Contredit temporairement §4 (justification du choix PostGIS via index GiST) — à revérifier après tout futur `prisma migrate dev`.

### 12.15 CRUD admin des arrêts (backend + frontend) + glisser-déposer simple/multiple — livré le 2026-09-08

**Contexte inter-sessions** : la session déléguée `gbakamaps-10` (§12.12/§12.14) a disparu au redémarrage de la machine avant de committer son travail — celui-ci est resté **stagé mais non committé** dans l'index Git partagé. Retrouvé, relu intégralement (diff complet), vérifié (relations `onDelete` confirmées dans `schema.prisma`, tests exécutés), puis committé par cette session (`087a737`) une fois sa qualité validée — jamais committé à l'aveugle seulement parce qu'il était présent dans l'index.

**Backend** (`087a737`) : `POST/PATCH/DELETE /api/admin/stops(/:id)` + `GET /admin/stops/:id/impact` (décompte réel avant suppression — favoris/dessertes détruits en cascade vs signalements détachés par `SetNull`, deux réalités différentes annoncées séparément, jamais un "êtes-vous sûr ?" aveugle). Garde-fous : `source` forcé à `COMMUNITY` et `osmId` jamais renseigné à la création (évite le bug `osmId=BigInt(Date.now())` de l'ancien projet, §7), nom vide → `null` jamais inventé, PATCH vide refusé explicitement (400). Pas de champ `active` ajouté à `Stop` (suppression dure assumée) pour éviter d'avoir à filtrer dessus dans nearby/search/trip-planning/matching places. 16 tests réels DB.

**Frontend** (`56f5819`) : écran `/admin/stops` avec liste (sélection multiple par cases à cocher), création (clic sur la carte en mode "ajouter"), édition, suppression avec impact affiché. Nouveau composant `AdminStopsMap.tsx`, **délibérément séparé** de `StopsMap.tsx` : la carte publique utilise depuis §12.11 une couche GeoJSON groupée (clustering) qui ne supporte pas le glisser-déposer nativement — ici, de vrais `Marker` MapLibre `draggable: true`, adapté à un jeu d'arrêts restreint (édition admin), pas à des centaines de points groupés.

**Déplacement par glisser-déposer, simple ou multiple** (demande explicite ultérieure de l'utilisateur) : glisser un arrêt qui fait partie d'une sélection de plusieurs arrêts déplace TOUS les arrêts sélectionnés du même delta réel ; sinon seul l'arrêt glissé bouge. Une mutation PATCH par arrêt déplacé (pas de nouvel endpoint de lot — volume typique d'un glisser-déposer trop faible pour le justifier). Vérifié par test navigateur réel avec un compte admin jetable : glisser-déposer simple confirmé persisté (PATCH 200), sélection de 3 arrêts + glisser-déposer de l'un d'eux confirmé déclenchant bien 3 PATCH.

**⚠️ Piège réel trouvé en testant, pas un bug** : le serveur de dev tournait sur un port (5180) hors de la liste CORS/origine autorisée (`FRONTEND_ORIGIN` ne contient que `5173` + un tunnel devtunnels) — toute mutation (POST/PATCH/DELETE) échouait en 403 "Invalid request origin" (protection anti-CSRF légitime dans `app.ts`), alors que les GET passaient normalement (pas de vérification d'origine dessus). Résolu en testant sur le port 5173 configuré. **Réflexe à prendre** : si un test navigateur montre des mutations en 403 mais que les lectures fonctionnent, vérifier le port du serveur de dev avant de suspecter le rôle/la session.

**⚠️ Pollution de données réelle laissée par les tests manuels — corrigée le 2026-09-08** : un arrêt réel importé d'OSM avait été renommé "Test rename" et déplacé pendant la vérification manuelle (curl + glisser-déposer réel). Corrigé en interrogeant directement l'API OSM officielle (`https://api.openstreetmap.org/api/0.6/node/<osmId>.json`, l'`osmId` réel étant conservé en base) : nom d'origine réel retrouvé ("Cash Center Plateau", SOTRA/réseau monBus, arrêt relevé en 2019), position d'origine restaurée depuis les coordonnées OSM. Leçon : quand un arrêt `source=OSM` est accidentellement modifié, son `osmId` permet TOUJOURS de retrouver la donnée d'origine réelle sans deviner — ne jamais improviser un nom/une position de repli.

### 12.16 Trois chantiers délégués — 2026-09-08

L'utilisateur a demandé de déléguer (Cline/OpenCode) les trois chantiers restants identifiés en §9 : CRUD admin des lignes (au-delà du tarif), extension du planificateur (correspondances via courte marche entre arrêts proches de lignes différentes), onboarding minimal. Délégué à la session peer `gbakamaps-f4` le 2026-09-08, avec consignes explicites :
- Committer très fréquemment (leçon tirée de §12.15 : `gbakamaps-10` a disparu au redémarrage machine sans avoir committé son travail CRUD arrêts, retrouvé stagé par chance) — jamais un seul gros commit final.
- Vérifier le bon repo avant de commencer : cette session avait initialement démarré sur `GbakaMaps` (l'ancien Next.js) par défaut, pas `gbakamap-mvp`.
- Pour le CRUD lignes : suivre le modèle direct déjà livré pour les arrêts (§12.15 — `useAdminStops.ts`/`AdminStopsPage.tsx`/`stops.routes.ts`), vérifier les relations `onDelete` dans `schema.prisma` avant de décider suppression dure vs désactivation, ne jamais laisser un PATCH non-tarifaire toucher `fareVerified`.
- Pour l'extension du planificateur : lire §12.7/§12.7bis d'abord — le principe "jamais un seul signal" (proximité ET nom, cf. `findMatchingStop`) ne s'applique pas tel quel ici (pas de nom à comparer entre deux arrêts distincts), donc un seul signal (distance) sera utilisé par nécessité — consigne explicite de documenter ce compromis clairement plutôt que de le laisser implicite, et de retester le genre de scénario qui avait révélé le bug des correspondances à 522 km/h (§12.7).

**État au moment de cette note : en attente de sa réponse.** Ne pas reconstruire ces chantiers en parallèle sans vérifier d'abord où en est cette délégation (`ListAgents` / historique des messages).

### 12.17 Exploration + implémentation autonome de 6 pistes — 2026-09-08

L'utilisateur a demandé d'explorer réellement (pas en théorie) et d'implémenter directement ce qui est viable, pour les 6 pistes de §9. Résultat par piste :

**🧭 Boussole — livré** (commit `0a05f3b`, voir détail dans le commit). Cap réel du capteur (iOS `requestPermission` sur geste utilisateur, Android/desktop `alpha`→cap) + direction calculée vers la destination en repli toujours disponible (`bearingBetween`). Flèche sur le point bleu, carte toujours Nord en haut. Test physique impossible dans cet environnement (aucun capteur réel) — vérifié par détection de fonctionnalités réelle + specs W3C/WebKit.

**📸 Photos des arrêts — livré, couverture partielle honnête** (commit `b917334`). Trois pistes gratuites testées à 0 % de couverture réelle (tags OSM déjà su, **Wikimedia Commons geosearch** et **KartaView** nouvellement testés ce jour — 0 résultat même près de la cathédrale du Plateau). Deux sources retenues après test réel sur 8 arrêts (plusieurs communes) : **Mapillary** (~25 % seul, token ajouté par l'utilisateur en cours de session — initialement déposé par erreur dans `GbakaMaps/.env`, l'ancien projet, corrigé) et **Panoramax** (agrégateur libre IGN/OSM France, CC-BY-SA, sans clé, découvert et testé ce jour — couverture partiellement différente de Mapillary) — combinées, ~37 %. Google Street View écarté (nécessiterait un compte Google Cloud payant, hors périmètre sans décision explicite de l'utilisateur — question posée, restée sans suite).

**📸bis Photos communautaires — livré, au-delà de la demande initiale** : l'utilisateur a demandé si les admins/utilisateurs pouvaient aussi ajouter leurs propres photos. Nouveau modèle `StopPhoto`, upload multipart (`@fastify/multipart`, 5 Mo max, jpeg/png/webp uniquement, nom de fichier généré côté serveur), stockage sur disque via un volume Docker nommé persistant (`backend_uploads` — jamais dans l'image, perdu sinon à chaque rebuild fréquent de ce projet), suppression réservée à l'auteur ou un admin. Testé réellement (7/7, fichier réellement écrit/lu sur disque).

**🤖 IA Gemini — livré** (commits `b917334`, `ace2f51`). Clés déjà dans `.env`, vérifiées réellement valides (`GET /v1beta/models`). Fonctionnalité retenue : narration en langage naturel d'un trajet déjà calculé (`GET /trip-plan/narrate`) — Gemini ne reçoit QUE des faits déjà vérifiés par notre moteur, interdiction explicite dans le prompt d'en ajouter. **Deux vrais bugs trouvés en testant réellement l'endpoint** (pas en théorie) : le modèle `gemini-flash-latest` fait du raisonnement interne par défaut qui tronquait les réponses en pleine phrase (corrigé avec `thinkingConfig.thinkingBudget: 0`), et la réponse peut être scindée en plusieurs `parts` dont une seule était lue (corrigé en les concaténant). Après correction : 3/3 appels réels réussis, texte complet et fidèle. Timeout porté à 25s (un appel réel peut légitimement prendre jusqu'à ~35s en cas de forte demande côté Google, 503 transitoire déjà rencontré et confirmé résolu par nouvelle tentative).

**🗺️ Isochrones — non viable actuellement, documenté** : ORS ET GraphHopper (nos deux fournisseurs de routing déjà configurés) refusent tous les deux l'accès à leur API isochrones sur le plan gratuit — testé réellement : ORS renvoie "Access to this API has been disallowed" (les deux clés, tous profils), GraphHopper renvoie "Too big time_limit... allowed: 0". Aucune des deux clés existantes ne débloque cette fonctionnalité — nécessiterait un abonnement payant, décision hors de mon périmètre. Piste alternative NON explorée faute de temps dans cette session : approximer une "zone accessible en X minutes" à partir de notre propre graphe de lignes (BFS sur `findReachableForward`/`findReachableBackward` du planificateur, §12.7) plutôt qu'un vrai calcul isochrone réseau-routier — resterait une approximation honnête (enveloppe des arrêts atteignables, pas un vrai polygone de rue), à concevoir si cette piste intéresse l'utilisateur plus tard.

**⚡ WebSocket/temps réel — non touché, conforme à la consigne** ("ne pas dégrader la stabilité du MVP pour ça"). Le MVP a plusieurs chantiers plus prioritaires encore ouverts (CRUD lignes, onboarding, extension du planificateur — §12.16) : introduire une infrastructure temps réel maintenant serait prématuré. Aucune interface/abstraction préparée non plus dans cette session — à faire au moment venu, pas anticipé inutilement.

**🚀 CI/CD — non touché, conforme à la consigne**. Le projet a une vraie suite de tests (backend : tests réels contre PostgreSQL/PostGIS et services externes réels, pas de mocks pour le chemin nominal ; frontend : vitest + axe-core + vérifications navigateur réelles Playwright ponctuelles) mais celle-ci dépend d'un vrai réseau (Overpass, ORS, Gemini, Mapillary, Panoramax) et d'une vraie base Docker — la brancher sur une CI GitHub Actions nécessiterait soit des secrets partagés (risque), soit un mode "CI" qui mock ces dépendances (irait à l'encontre de la philosophie actuelle du projet, "tester contre le vrai service"). Décision : ne rien construire maintenant, cohérent avec l'instruction explicite de l'utilisateur.

**Découverte de coordination pendant cette session** : trois nouvelles sessions peer Claude Code sont apparues (`gbakamaps-10`, `gbakamaps-82`, en plus de `gbakamaps-f4` déjà en cours), toutes démarrant par défaut sur l'ancien repo `GbakaMaps` — rebasculées sur `gbakamap-mvp`. `gbakamaps-82` a reçu le câblage frontend (galerie photos + bouton narration IA, pour ne pas dupliquer `gbakamaps-f4`/CRUD lignes), `gbakamaps-10` l'approximation d'isochrones (voir plus bas).

**⚠️ Erreur corrigée sur Cline/OpenCode** : j'ai d'abord affirmé à l'utilisateur ne pas pouvoir les atteindre (en confondant avec le canal `SendMessage`/`ListAgents`, qui ne joint que des sessions Claude Code) — l'utilisateur a corrigé : **`cline` et `opencode` sont de vrais outils CLI installés sur cette machine** (`npm list -g` → `cline@3.0.61`, `opencode-ai@1.18.29`), invocables directement en Bash et réellement authentifiés (Cline : compte connecté réel ; OpenCode : credential "OpenCode Zen"). Mémoire persistante dédiée créée pour ne jamais reproduire cette erreur (`delegation-cline-opencode.md`).

**Comment les invoquer réellement** (vérifié empiriquement le 2026-09-08) :
- `cline --cwd <chemin absolu> --auto-approve true --thinking medium --timeout <secondes> "<prompt>"` — mode non-interactif direct, un vrai compte est déjà connecté.
- `opencode run --dir <chemin absolu> --model opencode/<id> "<prompt>"` — le modèle par défaut/premier testé (`claude-sonnet-5`) a échoué avec "No payment method" (facturation requise) ; **`opencode/muse-spark-1.3-contributor-free` fonctionne réellement sans facturation** (déjà validé une fois précédemment dans ce projet, reconfirmé ce jour).
- **Piège réel rencontré** : lancer ces commandes avec un `&` de shell EN PLUS de `run_in_background: true` sur l'outil Bash coupe le processus prématurément (le `&` détache le processus avant que l'outil ne commence son propre suivi en arrière-plan, et le process enfant se retrouve orphelin/tué à la fin de l'appel d'outil) — les deux premiers essais se sont arrêtés après quelques secondes sans finir la tâche. **Ne jamais combiner les deux** : soit un `&` en foreground (l'outil attend la fin), soit `run_in_background: true` sur une commande SANS `&` (l'outil gère lui-même le détachement et le suivi jusqu'à la vraie fin).

Délégué à Cline (onboarding minimal) et OpenCode (CI/CD minimale, `muse-spark-1.3-contributor-free`) le 2026-09-08 — voir l'historique de conversation pour l'état exact au moment de la délégation, à vérifier/committer une fois leur exécution terminée.

### 12.18 Approximation "zone accessible en X minutes" (backend + frontend) — livré le 2026-09-08

Suite directe de la piste alternative esquissée en §12.17 ("Isochrones — non viable") : ORS et GraphHopper refusant tous deux leur API isochrone sur le plan gratuit (décision "payant" hors périmètre), on approxime la zone accessible avec **notre propre graphe de lignes**, jamais un vrai calcul de rue. Délégué par la session `gbakamaps-8a` à cette session (Claude Code, Sonnet 5).

**Backend** (commits `9bb9ff8` service/schéma/route, `fea3ffc` tests) : `GET /api/isochrone?from=lat,lon&maxMinutes=&walkRadius=&maxRides=`. Convention de coordonnées alignée sur `tripPlanQuerySchema` (`from=lat,lon` combiné, pas `lat=&lon=` séparés). `computeReachableStops()` ajouté à `trip-planning.service.ts` (convention module stricte `*.schemas/*.service/*.routes` respectée, un seul fichier service).

**Algorithme** : parcours en largeur niveau par niveau (un embarquement de plus par niveau, borné par `maxRides`, défaut 3 = jusqu'à 2 correspondances), relâchement du plus petit temps d'arrivée connu par arrêt. À chaque arrêt de la frontière : pour chaque desserte `StopLine` (ligne+sens+séquence), tous les arrêts en aval de la MÊME ligne+sens (séquence strictement supérieure) via `estimateRideSeconds` (temps GTFS relatif quand dispo, repli distance sinon — réutilise l'existant). Correspondance = changement de véhicule au MÊME arrêt physique uniquement. Caches DB : dessertes par arrêt (batch), séquence par (ligne, sens) (une requête chacune, plafonnée à `MAX_SEGMENT_FETCHES=400` → `truncated:true` au-delà).

**Garde-fou "jamais inventer une correspondance/donnée" respecté** : un arrêt n'est inclus QUE s'il est atteignable par une chaîne de lignes réelles (lineId+direction+sequence cohérents, sens respecté). La SEULE proximité géographique utilisée est la marche origine → premier arrêt embarquable (légitime, comme `planTrip`). Contrairement à `findMatchingStop` (§12.7bis), il n'y a ici aucun "deuxième signal" à exiger : on ne rapproche pas deux entités homonymes, on suit des arêtes de graphe déjà vérifiées à l'import.

**Limites, à afficher côté client** : (a) le temps d'attente aux correspondances n'est **pas** modélisé (`TRANSFER_WAIT_SECONDS = 0` — aucune donnée de fréquence des gbaka/woro-woro, §4) → l'approximation est **optimiste**, les temps réels seront plus longs ; cohérent avec `planTrip` qui ne modélise pas non plus l'attente. (b) `maxRides` borne l'exploration (garde-fou de calcul autant que choix produit). (c) La réponse porte `approximation: true` + une `note` explicite ; le résultat est un **ensemble d'arrêts** (`reachableStops[]` avec `etaSeconds`/`rides`/`lastLine`), pas un polygone lissé — volontairement.

**Vérifié réellement** : `tsc` OK ; 8 tests d'intégration dédiés (`tests/isochrone.test.ts`, vraie base, topologie semée, coords isolées) + 7 tests `trip-planning` toujours verts ; image Docker backend reconstruite (`docker compose up -d --build backend` — réflexe §12.13) puis `curl` réel contre `localhost:4000` sur données GTFS réelles : depuis le Plateau, 164 arrêts à 20 min / 598 à 45 min, **vitesse en ligne droite max implicite 17,4 km/h** (plausible, cf. bug des 522 km/h §12.7 — aucune correspondance absurde), `truncated:false`, 171–217 segments explorés.

**⚠️ Coordination inter-sessions constatée pendant ce travail** : la branche Git a été renommée `master` → `main` par une autre session pendant que je travaillais (repo/working-dir partagé, cf. §12.14). Sans divergence — historique linéaire, mes commits proprement au-dessus du travail onboarding de Cline. Les 6 échecs de `places.test.ts` observés au passage sont la flakiness Overpass réseau déjà documentée (§12.13), reproduits en isolation le même jour, **sans rapport avec ce changement** (module `places` non touché).

**Frontend** (commits `bcc170e` feature, `8522bbe` test — feu vert de `gbakamaps-8a` après le point de synchro backend) : toggle "zone accessible" dans la barre du bas (à côté de rayon / quartiers) → l'utilisateur choisit un point (clic sur la carte OU bouton "partez de ma position") + un budget 15/30/45 min. Les arrêts atteignables sont **surlignés d'un halo violet** (3 nuances selon la part du budget consommée), marqueur violet au point de départ.
- **Pas de polygone lissé** : aucune lib hull dans le projet (vérifié : ni turf ni d3 dans `package.json`) — et ce serait malhonnête pour une approximation. Simple surlignage des arrêts déjà affichés, comme convenu avec `gbakamaps-8a`.
- Nouveau hook `useReachableStops` (désactivé tant qu'aucun point choisi, cache 5 min). `StopsMap` : couche halo (`REACHABLE_*`) dessinée **sous** les arrêts/groupes (aucun point réel masqué), redessinée après `setStyle` comme les autres couches perso.
- **Mention honnête visible dans le panneau** : « Estimation optimiste, sans temps d'attente aux correspondances. Approximation basée sur les arrêts atteignables via les lignes connues — pas un vrai calcul d'itinéraire de rue. »
- **Layout** : panneau placé **en bas à gauche** (au-dessus de la légende), délibérément PAS en haut à gauche où il recouvrait le sélecteur de style de carte (même slot `top`/`left`) — corrigé dans l'espace, pas au z-index (leçon §12.5). z-index 9 (sous légende/sélecteur) : c'est ce panneau temporaire qui cède en cas de contact.
- **Vérifié en navigateur réel** (Edge/Playwright, WebGL logiciel SwiftShader) : toggle → panneau → "ma position" → requête `GET /api/isochrone` 200 (305 arrêts @30 min, 620 @45 min, `approximation:true`, `truncated:false`) → halos violets réellement rendus (capture inspectée) → changement 30→45 min déclenche une nouvelle requête → fermeture retire panneau + halo + marqueur. `tsc` OK (hors 2 erreurs **pré-existantes** dans `useDeviceOrientation.test.ts`, confirmées sur `HEAD` avant ce travail, sans rapport), 86/86 tests frontend (dont 3 nouveaux `useReachableStops`), `vite build` OK.

### 12.19 Tracé RÉEL des lignes de bus/gbaka/woro-woro — data.gouv.ci — livré le 2026-09-08

Suite à la correction de l'utilisateur en §12.17 ("OI MAIS overpass motre le tracer des trajet de bus" — Overpass expose bien des relations `route=bus` avec géométrie), puis à un fichier local qu'il a fourni (`abidjantransport_lignes.geojson`) et enfin au pointeur direct vers la source : **https://data.gouv.ci/datasets/abidjantransport-lignes** (jeu "Lignes de transport à Abidjan", licence ouverte, source DigitalTransport4Africa/OSM `route=bus`, relevé 2021, republié via la plateforme **data-fair** de Koumoul — API REST réelle et documentée, pas un simple CSV statique).

**Recherche empirique sur data.gouv.ci (pas une supposition)** : le portail n'est pas un udata standard (les endpoints `/api/1/...` répondent 404) mais une instance **data-fair** — API sous `https://data.gouv.ci/data-fair/api/v1/datasets/<slug>/lines?size=&after=` (pagination par curseur, `total` explicite), `/raw` (fichier original), `/lines?format=geojson` possible. Vérifié aussi l'existence d'un second jeu **très utile pour une prochaine itération** : `gares-routieres-et-arrets-bus-et-bateaux-sotra` (2166 arrêts/gares/stations officiels SOTRA, catégories `Arrêt de bus`/`Arrêt de bateau`/`Gare SOTRA`, mis à jour 2025-06-11) — **non encore intégré**, piste pour enrichir/croiser avec les arrêts OSM existants (même discipline de correspondance à double signal que §12.7bis, jamais une fusion automatique).

**Correspondance ID exacte, vérifiée avant tout import** : `TransportLine.externalRef` (format `"r<id_relation_OSM>"`, ex. `"r5985016"`, posé par `import-gtfs.ts`) et `line_id` du jeu data.gouv.ci (format `"Line:relation:<id_relation_OSM>"`) référencent la **même relation OSM** — confirmé concrètement sur la ligne "06" (Aéroport ↔ Gare Sud, cohérente des deux côtés) avant tout script écrit. Sur les 391 lignes en base avec un `externalRef`, **318 ont une correspondance exacte** dans les 325 lignes du jeu (les 7 restantes du jeu et les 73 lignes DB non couvertes n'ont PAS de tracé — jamais une approximation ou un tracé d'une autre ligne à la place).

**Schéma** (migration `20260908141344_add_transport_line_shape`) : `TransportLine.shapeGeoJson Json?` (géométrie GeoJSON `MultiLineString` telle quelle, jamais un type PostGIS `Unsupported` — donnée statique, jamais interrogée spatialement, seulement relue et renvoyée au frontend) + `shapeSource String?` (traçabilité de la provenance, pour ne jamais confondre un tracé officiel avec une future approximation maison).

**Script** `backend/src/scripts/import-line-shapes.ts` (`npm run import:line-shapes`) : interroge l'API data-fair **en direct** (pas de dépendance à un fichier exporté sur un disque local), upsert par `externalRef` uniquement (jamais de correspondance floue par nom), ne crée jamais de nouvelle `TransportLine` (ce jeu n'a pas le détail arrêts/séquence/tarif nécessaire). Exécuté réellement : 325 lignes reçues, **318 tracés appliqués**, 7 sans correspondance en base.

**Exposition API** : `GET /api/lines/:id` renvoie désormais `shapeGeoJson`/`shapeSource` (null si pas de tracé connu — jamais un tracé deviné). Vérifié par `curl` réel après reconstruction de l'image Docker backend (`docker compose up -d --build backend`, réflexe déjà noté §12.13/12.18 — **pas de bind-mount du code source**, un simple `restart` ne suffit jamais) : ligne "06" → `shapeSource: "data.gouv.ci/datasets/abidjantransport-lignes"`, `shapeGeoJson.type: "MultiLineString"`, 186 sous-lignes.

**Frontend — remplace l'approximation routière pour les étapes "ride" quand un tracé réel existe** (`useTripSegments.ts` réécrit) : pour chaque étape "ride" du plan de trajet, on tente d'abord `extractRideSegment()` — recherche du point le plus proche du tracé officiel de la ligne pour l'arrêt de montée et l'arrêt de descente (distance équirectangulaire, suffisante à cette échelle), découpe la sous-ligne du `MultiLineString` entre ces deux points. **Garde-fou** : si l'un des deux arrêts est à plus de 350 m (`RIDE_SNAP_MAX_M`) du point le plus proche du tracé connu, on ne fait PAS confiance à cette extraction (variante de direction différente, portion manquante) et on retombe sur le tracé routier calculé via `/api/route` (ORS/GraphHopper, déjà en place depuis le bug §12.17 "ligne droite traverse la lagune"). Ne recombine jamais deux sous-lignes différentes entre elles — chercher la meilleure sous-ligne indépendamment, jamais une jonction inventée. Disclaimer sous la carte mis à jour en conséquence (mentionne explicitement les deux sources possibles).

**Vérifié réellement** : `tsc --noEmit` OK (backend et frontend) ; 5 nouveaux tests unitaires `useTripSegments.test.ts` (découpage simple, inversion départ/arrivée, rejet si arrêt trop loin du tracé connu, sélection de la bonne sous-ligne parmi plusieurs branches d'un `MultiLineString`, rejet d'une géométrie non supportée) — tous verts. Migration appliquée et vérifiée en base réelle (`psql`), endpoint vérifié par `curl` réel après rebuild Docker (pas seulement en local, où le client Prisma régénéré n'était pas encore visible du conteneur — confirmé empiriquement : un `restart` seul renvoyait encore `shapeSource: undefined`, seul un rebuild d'image a résolu ceci, car ce service n'a pas de bind-mount de code source contrairement à d'autres réflexes déjà documentés).

**Fiabilité du découpage — vérifiée après coup, sur demande explicite de l'utilisateur** ("tu as exploité au maximu tout les donnée ? [...] pas de colision ou de contrdiction pour le user finaL ?") : crainte légitime que le tracé officiel, stocké en centaines de petits segments OSM déconnectés (186 sous-lignes pour la seule ligne "06"), fasse échouer `extractRideSegment` pour la plupart des trajets réels (l'algorithme ne recombine jamais deux sous-lignes). Testé sur **1691 paires d'arrêts consécutifs réels, 40 lignes** : **88,3% trouvent un vrai tracé officiel**, 11,7% retombent proprement sur le routage routier (repli déjà en place, pas d'échec silencieux), **0 détour absurde** (aucun segment >6x la distance à vol d'oiseau ou >15km, sur les 1493 tracés trouvés). Script de vérification jetable, non committé (`verify_shapes_tmp.mjs`/`verify_shapes_broad_tmp.mjs`, supprimés après usage).

### 12.20 Comblement des arrêts SOTRA officiels manquants — data.gouv.ci — livré le 2026-09-08

Suite directe de §12.19 : en explorant data.gouv.ci pour les tracés de lignes, découverte d'un second jeu exploitable, **`gares-routieres-et-arrets-bus-et-bateaux-sotra`** (2166 arrêts/gares/stations officiels, catégories `Arrêt de bus` (2147) / `Arrêt de bateau` (13) / `Gare SOTRA` (6), mis à jour 2025-06-11 côté portail, relevé terrain 2021).

**Correspondance encore plus forte que pour les lignes — un ID OSM identique, pas une simple corrélation** : le champ `id`/`@id` de ce jeu EST directement soit `node/<id_nœud_OSM>` (2160 entrées) soit `way/<id_way_OSM>` (6 entrées, les "Gare SOTRA" — polygones de bâtiment). Or `Stop.osmId` (posé par `import-gtfs.ts`) est EXACTEMENT ce même ID de nœud OSM pour les arrêts déjà importés — vérifié concrètement : **2076 des 2160 entrées "node/" ont déjà un `Stop.osmId` correspondant en base** (même entité OSM, pas un rapprochement par nom/proximité). Les **84 restantes sont de vrais arrêts SOTRA officiels absents de notre couverture GTFS actuelle** — candidats légitimes à l'ajout, avec le signal de correspondance le plus fort possible (identité, pas ressemblance).

**Les 6 "Gare SOTRA" (`way/...`)** : vérifiées **manuellement** une par une (`ST_DWithin` 400m + comparaison de nom) plutôt qu'importées automatiquement — nos `Stop.osmId` ne référencent que des nœuds, jamais des ways, donc pas de correspondance par ID possible pour elles. Les 6 correspondent déjà à un arrêt existant à 6–27m avec un nom identique ou quasi-identique (ex. "Gare Sotra Abobo" ↔ way "Gare SOTRA Abobo Sogefiha" à 6,7m) : **rien à créer**. Volontairement pas de rapprochement automatique par polygone pour seulement 6 entrées stables — complexité non justifiée, documenté comme limite connue du script si le jeu de données venait à en ajouter une nouvelle.

**Script** `backend/src/scripts/import-sotra-stops.ts` (`npm run import:sotra-stops`) : interroge l'API data-fair en direct, ne CRÉE que les arrêts dont l'`osmId` n'existe pas encore en base (jamais un écrasement d'un arrêt déjà connu, qui perdrait ses tags GTFS enrichis gbaka/woroworo), matching par ID de nœud OSM exact uniquement — pas de double-signal nécessaire ici, contrairement à §12.7bis, car l'identité d'entité OSM est déjà la preuve la plus forte. `Catégorie` → `StopType` : "Arrêt de bus" → `BUS_STOP`, "Arrêt de bateau" → `STATION` (notre enum n'a pas de type bateau dédié — mapping prudent qui ne mentirait pas sur la nature de l'arrêt ; au moment de l'exécution, les 84 manquants sont tous "Arrêt de bus", ce mapping ne sert qu'à ne pas casser si le jeu est étendu plus tard).

**Exécuté réellement** (deux fois, pour vérifier l'idempotence) : 1ère exécution → **84 nouveaux arrêts créés**, 2076 déjà présents, 6 "way" ignorés ; 2e exécution (après création) → 0 nouveau, 2160 déjà présents — confirme qu'aucun doublon n'est produit en relançant le script.

**Déploiement — problème réel trouvé et corrigé en vérifiant, pas en supposant** : en testant ces deux nouveaux scripts (et l'ancien `import-gtfs.ts`) contre l'**image Docker de production reconstruite** (pas seulement `npx tsx` en local), découvert que `Dockerfile` ne copiait jamais `backend/data/` dans l'image runtime — `import-gtfs.js` y aurait échoué (fichiers CSV introuvables) sur un vrai serveur. Corrigé (`COPY data ./data` dans le stage `runtime`) et re-vérifié : les 3 scripts compilés (`dist/scripts/*.js`, TypeScript compile bien les scripts vu `tsconfig.json` `include: ["src/**/*.ts"]`) tournent correctement dans le conteneur reconstruit. **Aucun des 3 imports n'est automatique** (ni au build, ni au démarrage du conteneur — décision assumée, pas un oubli : un import de données n'a pas sa place sur le chemin de démarrage d'un serveur de requêtes) — documenté explicitement dans le README (section "Lancer le backend entièrement en Docker") avec les commandes réelles à lancer manuellement après un premier déploiement.

**Fichier fourni par l'utilisateur (`abidjantransport_lignes.geojson`)** : déplacé dans `backend/data/abidjantransport-lignes/` (README expliquant sa provenance et pourquoi il n'est PAS lu par le code — `import-line-shapes.ts` interroge l'API en direct), et ajouté au `.gitignore`/`.dockerignore` (9,6 Mo, jamais utilisé activement, pas la peine d'alourdir l'historique Git ni l'image Docker).

### 12.21 Tracés de trajet plus visibles/animés + limites (attente/trafic/fréquence) affichées — livré le 2026-09-08

Deux demandes explicites de l'utilisateur traitées ensemble (commit `143cc3c`).

**Tracés "bien visible, original, animé, colorié dynamiquement"** (`StopsMap.tsx`) : la couche unique `trip-segments-line` remplacée par trois couches empilées — un halo sombre commun (visibilité sur tout fond de carte), une base SOLIDE colorée par la vraie couleur de la ligne empruntée (`TransportLine.color`, donc dynamique — pas de tireté dessus), et une fine surcouche animée (tireté clair, séquence `RIDE_DASH_SEQUENCE` jouée en boucle via `requestAnimationFrame`/`setPaintProperty`, technique standard MapLibre/Mapbox dite "marching ants") suggérant le sens du déplacement.

**Bug réel trouvé en vérifiant en navigateur réel** (pas supposé) : la première version (une seule couche tiretée, sans base solide) devenait presque invisible aux phases du cycle où le motif est surtout du "vide" — un utilisateur regardant (ou faisant une capture) à ce moment précis ne voyait plus qu'un halo gris, pas la couleur de la ligne. Corrigé en séparant base solide (toujours visible) et surcouche animée (purement décorative, jamais seule responsable de la visibilité/couleur). Vérifié par script Playwright réel (Edge headless, `channel: 'msedge'`) : trajet Institut des Aveugles → Terminus Saint André, capture inspectée après le correctif — couleur et visibilité stables.

**Limites (attente/embouteillages/fréquence) — remarque directe de l'utilisateur** : *"tu ne prend pas en compte les temps d'attente au aret de bus, les embouteillage, les frquance des bus et gbaka"*. Vérifié dans le code : déjà vrai (`TRANSFER_WAIT_SECONDS = 0`, aucune donnée de fréquence gbaka/woro-woro, routage ORS/GraphHopper sans trafic temps réel) mais **jamais affiché à l'utilisateur** dans le planificateur principal — seulement dans la note de `/isochrone`. Corrigé : la `note` de `GET /trip-plan` (déjà affichée telle quelle par `TripPlannerPage.tsx`) précise désormais explicitement ces trois non-prises-en-compte, avec la conséquence honnête ("durées donc plutôt optimistes").

**Vérifié réellement** : `tsc --noEmit` OK (backend+frontend), 98/98 tests frontend, 7/7 `trip-planning.test.ts` (texte de note non fixé par un test existant, donc aucune régression).

### 12.22 CRUD complet des lignes (au-delà du tarif) — livré le 2026-09-09

Dernier des trois chantiers de §12.16 restés sans réponse de la délégation `gbakamaps-f4` — repris directement, sur le modèle exact du CRUD arrêts (§12.15). Commit à suivre.

**Backend** (`lines.schemas.ts`/`lines.service.ts`/`lines.routes.ts`) : l'ancien `PATCH /admin/lines/:id` (tarif seul, `setLineFareBodySchema`) **fusionné** dans un PATCH général (`updateLineBodySchema`, tous champs optionnels : nom, nom court, couleur `#RRGGBB`, opérateur, type de transport, `active`, `fare`) plutôt que dupliqué sur une autre route — la règle métier déjà testée (poser un tarif marque `fareVerified: true`) préservée à l'identique dans `updateLine()`, vérifiée par les 5 tests déjà existants (toujours verts sans modification). Ajout de `POST /admin/lines` (jamais d'`externalRef`/`shapeGeoJson` fabriqués — mêmes principes que §12.19/§12.16), `GET /admin/lines` (liste ADMIN distincte de `GET /lines` public : inclut les lignes désactivées, sinon impossible de les retrouver pour les réactiver), `GET /admin/lines/:id/impact` et `DELETE /admin/lines/:id` (suppression DURE, calquée sur `getStopDeletionImpact`).

**Décision produit : désactivation (`active: false`) recommandée plutôt que suppression dure**, contrairement à `Stop` qui n'a pas ce champ. Une ligne peut desservir des dizaines d'arrêts (`StopLine`, `onDelete: Cascade`) — la perte est toujours plus significative que celle d'un simple arrêt. La suppression dure reste disponible (avec impact affiché avant confirmation) pour les vraies erreurs de saisie.

**Bug réel trouvé en écrivant ce chantier, pas en théorie** : `listLines` (public) filtrait déjà `active: true`, mais **aucune des 4 requêtes `stopLine.findMany` de `trip-planning.service.ts`** (candidats de départ, `findReachableForward`/`findReachableBackward`, segments d'isochrone) ne filtrait dessus — désactiver une ligne depuis ce nouveau CRUD n'aurait donc eu qu'un effet cosmétique sur `/lines`, sans jamais empêcher le planificateur de continuer à la proposer. Corrigé (`line: { active: true }` ajouté aux 4 requêtes) et couvert par 2 nouveaux tests dédiés (`trip-planning.test.ts` : ligne désactivée exclue d'un trajet direct, puis d'une correspondance) — les deux échouaient avant le correctif, vérifié.

**Frontend** : nouveau hook `useAdminLines.ts` (liste/create/update/delete/impact, invalide `['lines']` ET `['admin-lines']` après mutation) + `AdminLinesPage.tsx` (`/admin/lines`, lien "Lignes" ajouté à `AuthStatus.tsx`) — page pleine largeur à une colonne (pas de carte, une ligne n'étant pas un point géolocalisé comme un arrêt), liste avec recherche, pastille de couleur réelle, badge "Désactivée", bouton bascule Désactiver/Réactiver, formulaires création/édition partagés, confirmation de suppression avec impact réel affiché.

**Vérifié réellement** : `tsc --noEmit` OK (backend+frontend) ; backend 15/15 `lines.test.ts` (7 nouveaux : création sans externalRef/tracé, rejet nom vide, PATCH ne touche pas un tarif non mentionné, désactivation sans perte de dessertes + disparition de la liste publique + présence dans la liste admin, impact avant suppression, suppression dure réelle) + 9/9 `trip-planning.test.ts` ; 98/98 tests frontend (7 nouveaux `useAdminLines.test.ts`) ; **vérifié en navigateur réel** (Edge/Playwright headless, session admin créée directement en base comme dans les tests d'intégration — pas de mot de passe deviné pour un vrai compte utilisateur) : création d'une ligne avec couleur personnalisée → désactivation → confirmation via `curl` réel que `GET /lines` public ne la retourne plus (0 résultat) alors que `GET /admin/lines` la montre toujours avec `active: false` → suppression dure → liste vide. Aucune erreur console à aucune étape. Image Docker backend reconstruite et testée après coup (réflexe §12.13).
