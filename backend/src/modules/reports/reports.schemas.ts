// =============================================================================
// Schémas de validation du module reports.
// =============================================================================
import { z } from 'zod';

export const reportTypeEnum = z.enum([
  'MISSING_STOP',
  'INCORRECT_INFO',
  'DAMAGE',
  'SAFETY_ISSUE',
  'NEW_LINE',
  'SCHEDULE_CHANGE',
  'DUPLICATE_STOP',
  'OTHER',
]);

export const reportStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RESOLVED']);

export const createReportBodySchema = z.object({
  reportType: reportTypeEnum,
  title: z.string().min(5).max(200),
  description: z.string().max(1000).optional(),
  stopId: z.string().uuid('Identifiant invalide').optional(),
  imageUrl: z.string().url().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

export const listAdminReportsQuerySchema = z.object({
  status: reportStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const moderateReportBodySchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'RESOLVED']),
});

export const reportIdParamsSchema = z.object({
  id: z.string().uuid('Identifiant invalide'),
});

export type CreateReportInput = z.infer<typeof createReportBodySchema>;
export type ListAdminReportsQuery = z.infer<typeof listAdminReportsQuerySchema>;
export type ModerateReportInput = z.infer<typeof moderateReportBodySchema>;
