// =============================================================================
// Configuration centralisée et validée des variables d'environnement.
// Le serveur refuse de démarrer si une variable requise est absente ou
// mal formée — corrige le comportement de l'ancien projet où une variable
// manquante provoquait des 500 opaques en cours d'exécution.
// =============================================================================
import 'dotenv/config';
import { z } from 'zod';

// Docker Compose transmet une variable listée dans `environment:` même
// quand elle n'est définie nulle part dans le `.env` — comme une CHAÎNE VIDE
// ("The ... variable is not set. Defaulting to a blank string."), pas comme
// une variable absente. Un `.optional()` seul ne suffit donc pas pour ces
// clés facultatives passées explicitement via docker-compose.yml : `""` est
// une valeur présente qui échouerait un `.min(1)`. Bug réellement rencontré
// le 2026-09-06 (conteneur backend en crash-loop après l'ajout de
// GRAPHHOPPER_API_KEY à `environment:` sans valeur dans `.env`) — cette
// fonction normalise `""` en `undefined` avant validation.
function optionalNonEmpty() {
  return z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET doit faire au moins 16 caractères'),
  SESSION_COOKIE_NAME: z.string().default('gbakamap_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  // Accepte une seule origine ("http://localhost:5173"), une liste séparée
  // par des virgules (dev local + tunnel), ou "*" pour tout autoriser
  // (jamais en production — cf. isAllowedOrigin).
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  // OpenRouteService (voir routing.service.ts) — remplace OSRM, dont le
  // serveur démo public s'est révélé ne pas distinguer les profils de
  // trajet malgré sa documentation. Compte gratuit requis sur
  // openrouteservice.org (pas de carte bancaire), même friction que
  // MapTiler côté frontend.
  ORS_API_KEY: z.string().min(1, 'ORS_API_KEY est requis (compte gratuit sur openrouteservice.org)'),
  ORS_BASE_URL: z.string().url().default('https://api.openrouteservice.org'),
  // Clé de secours : ORS applique un quota par clé (jour) ET une limite de
  // débit (minute) — constaté en pratique le 2026-09-06 pendant des tests
  // automatisés répétés (des appels curl isolés réussissaient juste après un
  // 503 sur la même route, signe d'une limite par minute plutôt qu'un vrai
  // incident). Une seconde clé (même compte ou un second compte gratuit)
  // absorbe ce cas sans jamais bloquer l'utilisateur. Optionnelle : le
  // système fonctionne avec une seule clé, juste avec moins de marge.
  ORS_API_KEY_2: optionalNonEmpty(),
  // Dernier recours si les deux clés ORS échouent : GraphHopper (compte
  // gratuit sur graphhopper.com, distingue réellement les profils
  // voiture/vélo/marche — contrairement à OSRM démo, écarté pour cette
  // raison, voir routing.service.ts). Optionnel : si absent, le système
  // renvoie une erreur claire plutôt que de silencieusement dégrader vers un
  // fournisseur non vérifié.
  GRAPHHOPPER_API_KEY: optionalNonEmpty(),
  GRAPHHOPPER_BASE_URL: z.string().url().default('https://graphhopper.com/api/1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuration invalide — variables d\'environnement manquantes ou incorrectes:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

const allowedOrigins = env.FRONTEND_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (env.NODE_ENV === 'production' && allowedOrigins.includes('*')) {
  console.error('❌ FRONTEND_ORIGIN="*" est interdit en production (CORS + cookies de session).');
  process.exit(1);
}

// Utilisé par le plugin CORS (voir app.ts) pour valider l'origine d'une
// requête entrante à l'exécution, puisque FRONTEND_ORIGIN peut désormais
// contenir plusieurs valeurs (dev local + tunnel de test) ou "*".
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // requêtes sans en-tête Origin (ex: curl, mobile natif)
  if (allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(origin);
}
