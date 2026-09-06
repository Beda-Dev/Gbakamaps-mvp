import { defineConfig } from '@playwright/test';

// Suite end-to-end (parcours critique) — voir frontend/e2e/critical-path.spec.ts.
//
// PRÉREQUIS (serveurs lancés séparément, jamais par Playwright) :
//   1. Backend + base : `docker compose up -d` depuis la racine du dépôt.
//   2. Frontend dev   : `npm run dev` dans frontend/ (http://localhost:5173).
// Puis : `npm run test:e2e`.
// En CI (pas encore configurée) ces deux services seront fournis de la même
// façon — d'où l'absence volontaire de `webServer` ici.
export default defineConfig({
  testDir: './e2e',
  // Les appels réels vers OpenRouteService / MapTiler via le backend peuvent
  // prendre plusieurs secondes chacun : large marge pour le parcours complet.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  // Pas de CI configurée pour l'instant : 0 retry pour ne masquer aucun flake.
  retries: 0,
  // Un seul worker : le parcours partage un compte de test unique.
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    // Edge est déjà installé sur les machines de dev (Windows) : pas de
    // `npx playwright install` (téléchargement Chromium) nécessaire.
    channel: 'msedge',
    launchOptions: {
      // Rendu WebGL logiciel en headless — combinaison exacte utilisée avec
      // succès pendant tout le développement (cf. PROJECT_MEMORY.md) : sans
      // elle MapLibre ne rend rien et aucun marqueur n'apparaît.
      args: [
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
