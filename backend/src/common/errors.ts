// =============================================================================
// Hiérarchie d'erreurs centralisée + handler global Fastify.
// Contrairement à l'ancien projet, ce fichier est réellement branché
// sur le serveur (voir server.ts: app.setErrorHandler).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export function globalErrorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error({ err: error }, 'Request error');

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.code,
      ...(process.env.NODE_ENV === 'development' && error.details
        ? { details: error.details }
        : {}),
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.flatten(),
    });
  }

  // Erreur Prisma (codes connus)
  if (error && typeof error === 'object' && 'code' in error) {
    const prismaCode = (error as { code: string }).code;
    if (prismaCode === 'P2002') {
      return reply.status(409).send({
        success: false,
        error: 'Duplicate entry',
        code: 'DUPLICATE_ENTRY',
      });
    }
    if (prismaCode === 'P2025') {
      return reply.status(404).send({
        success: false,
        error: 'Record not found',
        code: 'NOT_FOUND',
      });
    }
  }

  return reply.status(500).send({
    success: false,
    error:
      process.env.NODE_ENV === 'development'
        ? (error as Error)?.message ?? 'Unknown error'
        : 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
