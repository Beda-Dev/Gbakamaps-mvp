// =============================================================================
// Point d'entrée du backend — démarre le serveur HTTP construit par app.ts
// =============================================================================
import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
