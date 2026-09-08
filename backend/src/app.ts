// =============================================================================
// Construction de l'application Fastify, séparée du démarrage du serveur
// (server.ts) pour permettre aux tests d'utiliser app.inject() sans ouvrir
// de port réseau.
// =============================================================================
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { env, isAllowedOrigin } from './config/env.js';
import { globalErrorHandler, ForbiddenError } from './common/errors.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { stopsRoutes } from './modules/stops/stops.routes.js';
import { favoritesRoutes } from './modules/favorites/favorites.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { routingRoutes } from './modules/routing/routing.routes.js';
import { tripPlanningRoutes } from './modules/trip-planning/trip-planning.routes.js';
import { linesRoutes } from './modules/lines/lines.routes.js';
import { placesRoutes } from './modules/places/places.routes.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  app.decorateRequest('currentUser', undefined);

  app.setErrorHandler(globalErrorHandler);

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });

  await app.register(cookie);

  // Photos ajoutées par les utilisateurs/admins sur un arrêt (§9/§12.8) —
  // limite de taille stricte (5 Mo) : un upload volumineux ne doit jamais
  // pouvoir saturer le disque du conteneur, ni servir de vecteur de déni de
  // service trivial.
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  // Sert les photos uploadées en fichiers statiques — dossier persistant via
  // un volume Docker (voir docker-compose.yml), jamais dans le code source
  // de l'image (perdu à chaque rebuild sinon).
  const uploadsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
  // Créé au démarrage plutôt que supposé présent dans l'image/le volume —
  // fonctionne aussi bien en dev local (hors Docker) qu'en conteneur.
  mkdirSync(join(uploadsDir, 'stop-photos'), { recursive: true });
  // Préfixe SOUS /api (pas /uploads/ à la racine) : le proxy Vite dev
  // (frontend/vite.config.ts) ne redirige que "/api" vers le backend — un
  // chemin "/uploads/..." appelé depuis le frontend serait résolu contre le
  // serveur Vite lui-même (404), pas contre notre backend. Même règle à
  // reproduire en prod (voir le commentaire équivalent dans vite.config.ts).
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/api/uploads/',
    decorateReply: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
  });

  // Défense en profondeur contre le CSRF : SameSite=Lax bloque déjà l'envoi
  // du cookie de session sur une requête POST cross-site dans les
  // navigateurs modernes, mais on vérifie explicitement l'origine des
  // requêtes mutantes authentifiées par cookie (le cookie ne suffit pas
  // à autoriser une mutation si l'origine ne correspond pas au frontend).
  app.addHook('preHandler', async (request) => {
    const hasSessionCookie = Boolean(request.cookies[env.SESSION_COOKIE_NAME]);
    if (MUTATING_METHODS.has(request.method) && hasSessionCookie) {
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        throw new ForbiddenError('Invalid request origin');
      }
    }
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(stopsRoutes, { prefix: '/api' });
  await app.register(favoritesRoutes, { prefix: '/api' });
  await app.register(reportsRoutes, { prefix: '/api' });
  await app.register(routingRoutes, { prefix: '/api' });
  await app.register(tripPlanningRoutes, { prefix: '/api' });
  await app.register(linesRoutes, { prefix: '/api' });
  await app.register(placesRoutes, { prefix: '/api' });

  // Tous les modules métier du MVP sont enregistrés (auth, stops,
  // favorites, reports, routing).

  return app;
}
