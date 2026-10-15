import { z } from 'zod';

const uuid = z.uuid();
const nullableText = (max: number) => z.string().max(max).nullable();

export const uuidParam = uuid;

export const pageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createPostBody = z.object({
  clientId: uuid,
  text: z.string().max(2000),
  mediaIds: z.array(uuid).max(4).refine((ids) => new Set(ids).size === ids.length, { message: 'unique' }),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'GROUP']),
  groupId: uuid.optional(),
});

export const updateProfileBody = z
  .object({
    displayName: z.string().trim().min(2).max(50).optional(),
    career: nullableText(100).optional(),
    semester: z.number().int().min(1).max(14).nullable().optional(),
    bio: nullableText(280).optional(),
    interests: z
      .array(z.string().min(2).max(30))
      .max(10)
      .refine((v) => new Set(v).size === v.length, { message: 'unique' })
      .optional(),
    avatarMediaId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'minProperties' });

export const createCommentBody = z.object({ text: z.string().trim().min(1).max(500), parentId: uuid.optional() });
export const setReactionBody = z.object({ type: z.enum(['LIKE', 'HELPFUL', 'FUNNY', 'SUPPORT']) });
export const createGroupBody = z.object({
  name: z.string().trim().min(3).max(80),
  subject: z.string().trim().min(2).max(80),
  privacy: z.enum(['PUBLIC', 'PRIVATE']),
});
export const listGroupsQuery = pageQuery.extend({ query: z.string().trim().min(2).max(80).optional() });
export const listMembersQuery = pageQuery.extend({ status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'LEFT']).optional() });
export const suggestionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
export const reportBody = z.object({
  targetType: z.enum(['POST', 'COMMENT']),
  targetId: uuid,
  reason: z.enum(['SPAM', 'HARASSMENT', 'NSFW', 'VIOLENCE', 'MISINFORMATION', 'OTHER']),
  details: z.string().max(500).optional(),
});

export const postsByStatusQuery = pageQuery.extend({ status: z.enum(['PENDING_MEDIA', 'PUBLISHED', 'HIDDEN', 'REMOVED']).default('HIDDEN') });
export const updatePostStatusBody = z.object({ status: z.enum(['PUBLISHED', 'HIDDEN', 'REMOVED']), reason: z.string().min(3).max(500) });
export const reportsQuery = pageQuery.extend({ status: z.enum(['OPEN', 'RESOLVED_KEPT', 'RESOLVED_REMOVED']).default('OPEN') });
export const resolveReportBody = z.object({ resolution: z.enum(['KEEP', 'REMOVE']), note: z.string().max(500).optional() });
export const internalGroupsQuery = pageQuery.extend({ career: z.string().min(2).max(100).optional() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const statsQuery = z.object({ from: date, to: date, topHashtags: z.coerce.number().int().min(0).max(50).default(10) });
export const actorHeader = uuid;
