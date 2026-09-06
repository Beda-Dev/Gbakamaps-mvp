// =============================================================================
// Configuration centralisée et validée des variables d'environnement.
// Le serveur refuse de démarrer si une variable requise est absente ou
// mal formée — corrige le comportement de l'ancien projet où une variable
// manquante provoquait des 500 opaques en cours d'exécution.
// =============================================================================
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET doit faire au moins 16 caractères'),
  SESSION_COOKIE_NAME: z.string().default('gbakamap_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuration invalide — variables d\'environnement manquantes ou incorrectes:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
