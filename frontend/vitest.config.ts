import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Convention de test frontend (première suite du projet) : composants React
// testés avec fetch mocké — aucun appel réseau réel, contrairement au backend
// qui teste contre une vraie base (cf. README backend).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // La suite Playwright (e2e/, vrais services) n'est jamais ramassée par
    // vitest : ce sont des specs navigateur, pas des tests unitaires jsdom.
    exclude: ['e2e/**', 'node_modules/**'],
    // Base d'URL réaliste pour les assertions sur les appels API.
    env: {
      VITE_API_URL: 'http://localhost:4000/api',
    },
  },
});
