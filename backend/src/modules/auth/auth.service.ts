// =============================================================================
// Logique métier de l'authentification.
// Décisions (voir audit + validation utilisateur) :
//   - argon2id pour le hash des mots de passe (recommandation OWASP actuelle)
//   - sessions opaques stockées en base, PAS de JWT côté client : permet la
//     révocation immédiate (nécessaire pour la modération/bannissement)
//   - comparaison à temps constant même quand l'utilisateur n'existe pas,
//     pour ne pas révéler par le timing de réponse si un email est enregistré
// =============================================================================
import argon2 from 'argon2';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { ConflictError, UnauthorizedError } from '../../common/errors.js';
import type { SignupInput, LoginInput } from './auth.schemas.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB — recommandation OWASP 2024 pour argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

// Hash factice précalculé au démarrage, utilisé pour égaliser le temps de
// réponse d'un login quand l'utilisateur n'existe pas (anti timing-attack).
const DUMMY_HASH = await argon2.hash('no-such-user-dummy-password', ARGON2_OPTIONS);

export async function signup(input: SignupInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('Un compte existe déjà avec cet email');
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    },
  });
}

export async function verifyCredentials(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const hashToVerify = user?.passwordHash ?? DUMMY_HASH;

  const isValid = await argon2.verify(hashToVerify, input.password).catch(() => false);

  if (!user || !isValid) {
    throw new UnauthorizedError('Email ou mot de passe incorrect');
  }

  return user;
}

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  return prisma.session.create({ data: { userId, expiresAt } });
}

export async function getSessionWithUser(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    // Session expirée : nettoyage opportuniste, pas de dépendance à un cron
    // pour que l'expiration soit effective (le cron sert juste le ménage).
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session;
}

export async function revokeSession(sessionId: string) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {
    // Idempotent : si la session n'existe déjà plus, ce n'est pas une erreur.
  });
}
