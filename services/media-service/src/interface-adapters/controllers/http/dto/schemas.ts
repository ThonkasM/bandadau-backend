import { z } from 'zod';

const uuid = z.uuid();
export const uuidParam = uuid;
export const actorHeader = uuid;

export const createUploadBody = z.object({
  kind: z.enum(['IMAGE', 'VIDEO']),
  purpose: z.enum(['POST', 'AVATAR', 'EVENT_COVER']).default('POST'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']),
  sizeBytes: z.number().int().min(1).max(52_428_800),
  durationSeconds: z.number().positive().max(60).optional(),
  fileName: z.string().max(255).optional(),
});

export const decideBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() });

export const flaggedQuery = z.object({
  status: z.enum(['PENDING_UPLOAD', 'PROCESSING', 'APPROVED', 'FLAGGED', 'REJECTED']).default('FLAGGED'),
  ownerId: uuid.optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** `ids` arrives as repeated `ids=a&ids=b` (OpenAPI form/explode) or comma separated. */
export const urlsQuery = z.object({
  ids: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(uuid).min(1).max(50)),
  includeUnapproved: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
