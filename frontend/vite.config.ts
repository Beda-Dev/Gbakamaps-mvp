import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  optimizeDeps: {
    // maplibre-gl charge son moteur de rendu dans un Web Worker. Le
    // pré-bundling de Vite casse ce chargement en dev (404 sur
    // maplibre-gl-worker.mjs) : la carte reste vide, l'événement 'load'
    // n'est jamais émis et aucun marqueur n'est ajouté. L'exclure du
    // pré-bundling règle le problème (le build de production, lui,
    // empaquette le worker correctement).
    exclude: ['maplibre-gl'],
  },
  resolve: {
    alias: {
      // Vite ne lit PAS les `paths` de tsconfig.json : sans cet alias,
      // `tsc` passe mais le serveur de dev renvoie 500 sur tout module
      // important `@/...` au runtime (et le build produit un bundle
      // cassé en traitant ces imports comme des dépendances externes).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // La PWA n'a de sens qu'installée sur un vrai déploiement HTTPS ;
      // en dev le SW est quand même activé pour pouvoir tester
      // l'installabilité localement sans surprise en prod.
      devOptions: { enabled: true },
      manifest: {
        name: 'GbakaMap',
        short_name: 'GbakaMap',
        description: "Localiser les arrêts de transport (bus, gbaka, woro-woro) en Côte d'Ivoire",
        theme_color: '#0A9396',
        background_color: '#FAFAFA',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Les appels API ne sont jamais mis en cache par le service worker :
        // le MVP n'a pas de mode hors-ligne (décision explicite, cf. audit),
        // un cache silencieux de /api/* donnerait des données périmées.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
