// =============================================================================
// Test de non-régression : Docker Compose transmet une variable listée dans
// `environment:` mais absente du `.env` comme une CHAÎNE VIDE, pas comme une
// variable absente ("The ... variable is not set. Defaulting to a blank
// string."). Bug réel rencontré le 2026-09-06 : le conteneur backend est
// entré en crash-loop après l'ajout de GRAPHHOPPER_API_KEY à
// `environment:` sans valeur dans `.env` — `z.string().min(1).optional()`
// rejette `""` (présente mais invalide) au lieu de la traiter comme absente.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REQUIRED_BASE_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SESSION_SECRET: 'a'.repeat(32),
  ORS_API_KEY: 'test-ors-key',
};

async function loadEnvWith(overrides: Record<string, string>) {
  vi.resetModules();
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...REQUIRED_BASE_ENV, ...overrides };
  try {
    return await import('../src/config/env.js');
  } finally {
    process.env = originalEnv;
  }
}

describe('config/env — variables optionnelles facultatives', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // process.exit(1) ferait planter le test runner lui-même si la
    // validation échouait de façon inattendue — on l'intercepte.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('une chaîne vide ("") pour ORS_API_KEY_2 est traitée comme absente, pas comme invalide', async () => {
    const { env } = await loadEnvWith({ ORS_API_KEY_2: '', GRAPHHOPPER_API_KEY: '' });
    expect(env.ORS_API_KEY_2).toBeUndefined();
    expect(env.GRAPHHOPPER_API_KEY).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('une vraie valeur pour ORS_API_KEY_2 est bien conservée', async () => {
    const { env } = await loadEnvWith({ ORS_API_KEY_2: 'ma-cle-de-secours' });
    expect(env.ORS_API_KEY_2).toBe('ma-cle-de-secours');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('ORS_API_KEY_2 absente du tout (jamais définie) reste undefined sans erreur', async () => {
    const { env } = await loadEnvWith({});
    expect(env.ORS_API_KEY_2).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
