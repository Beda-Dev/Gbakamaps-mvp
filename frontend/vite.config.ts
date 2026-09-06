import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
