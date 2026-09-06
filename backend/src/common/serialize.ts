// =============================================================================
// Utilitaires de sérialisation partagés entre modules.
// Fastify (comme JSON.stringify natif) ne sait pas sérialiser un BigInt —
// tout modèle exposant "osmId" (Stop) doit passer par ici avant de quitter
// la couche service, sous peine de 500 sur toute réponse qui l'inclut.
// =============================================================================
export function serializeStopBigInt<T extends { osmId: bigint | null }>(stop: T) {
  const { osmId, ...rest } = stop;
  return { ...rest, osmId: osmId === null ? null : osmId.toString() };
}
