// =============================================================================
// Logique métier du module favorites.
// Toute lecture/écriture est scopée par userId (fourni par requireAuth via
// request.currentUser.id) — jamais par un userId venu du client — pour
// qu'un utilisateur ne puisse ni lire ni supprimer les favoris d'un autre.
// =============================================================================
import { prisma } from '../../db/prisma.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { serializeStopBigInt } from '../../common/serialize.js';

function toApiFavorite<T extends { stop: { osmId: bigint | null } } & Record<string, unknown>>(
  favorite: T
) {
  const { stop, ...rest } = favorite;
  return { ...rest, stop: serializeStopBigInt(stop) };
}

export async function addFavorite(userId: string, stopId: string) {
  const stop = await prisma.stop.findUnique({ where: { id: stopId } });
  if (!stop) {
    throw new NotFoundError('Arrêt');
  }

  const existing = await prisma.favorite.findFirst({ where: { userId, stopId } });
  if (existing) {
    throw new ConflictError('Cet arrêt est déjà dans vos favoris');
  }

  const favorite = await prisma.favorite.create({
    data: { userId, stopId },
    include: { stop: true },
  });

  return toApiFavorite(favorite);
}

export async function listFavorites(userId: string) {
  const favorites = await prisma.favorite.findMany({
    where: { userId },
    include: { stop: true },
    orderBy: { createdAt: 'desc' },
  });

  return favorites.map(toApiFavorite);
}

export async function removeFavorite(userId: string, stopId: string) {
  const existing = await prisma.favorite.findFirst({ where: { userId, stopId } });
  if (!existing) {
    // 404 volontaire (pas 403) : ne pas révéler si le favori existe
    // pour un autre utilisateur.
    throw new NotFoundError('Favori');
  }

  await prisma.favorite.delete({ where: { id: existing.id } });
}
