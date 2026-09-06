// =============================================================================
// Construction de l'application Fastify, séparée du démarrage du serveur
// (server.ts) pour permettre aux tests d'utiliser app.inject() sans ouvrir
// de port réseau.
// =============================================================================
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { globalErrorHandler, ForbiddenError } from './common/errors.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { stopsRoutes } from './modules/stops/stops.routes.js';
import { favoritesRoutes } from './modules/favorites/favorites.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { routingRoutes } from './modules/routing/routing.routes.js';

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
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  });

  await app.register(cookie);

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
      if (origin && origin !== env.FRONTEND_ORIGIN) {
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

  // Tous les modules métier du MVP sont enregistrés (auth, stops,
  // favorites, reports, routing).

  return app;
}
