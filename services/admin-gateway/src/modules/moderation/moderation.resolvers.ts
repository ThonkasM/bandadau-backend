import type { GatewayContext } from '../../graphql/context';
import { type MediaAssetModel, mediaFromUrl, type PostModel } from './moderation.mappers';
import type { ModerationService } from './moderation.service';

type Ctx = GatewayContext;

export function moderationResolvers(service: ModerationService) {
  return {
    Query: {
      moderationQueue: (_: unknown, args: never, ctx: Ctx) => service.queue(ctx, args),
      contentReports: (_: unknown, args: never, ctx: Ctx) => service.contentReports(ctx, args),
    },
    Mutation: {
      moderateMedia: (_: unknown, args: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string }, ctx: Ctx) => service.moderateMedia(ctx, args),
      resolveContentReport: (_: unknown, a: { input: { reportId: string; resolution: string; note?: string } }, ctx: Ctx) => service.resolveReport(ctx, a.input),
    },
    MediaAsset: {
      owner: (m: MediaAssetModel, _: unknown, ctx: Ctx) => ctx.loaders.users.load(m.ownerId),
    },
    Post: {
      author: (p: PostModel, _: unknown, ctx: Ctx) => ctx.loaders.users.load(p.authorId),
      media: async (p: PostModel, _: unknown, ctx: Ctx) => {
        const loaded = await Promise.all(p.mediaIds.map((m) => ctx.loaders.media.load(m.mediaId)));
        return loaded.map((u, i) => {
          const fallback = p.mediaIds[i]!;
          return mediaFromUrl(u ?? { mediaId: fallback.mediaId, kind: fallback.kind, purpose: 'POST', status: fallback.status, url: fallback.url, thumbnailUrl: fallback.thumbnailUrl }, p.authorId, p.createdAt);
        });
      },
    },
    Comment: {
      author: (c: { authorId: string }, _: unknown, ctx: Ctx) => ctx.loaders.users.load(c.authorId),
    },
    ContentReport: {
      reporter: (r: { reporterId: string }, _: unknown, ctx: Ctx) => ctx.loaders.users.load(r.reporterId),
      post: async (r: { targetType: string; targetId: string }, _: unknown, ctx: Ctx) => {
        if (r.targetType === 'POST') return ctx.loaders.posts.load(r.targetId);
        const comment = await ctx.loaders.comments.load(r.targetId);
        return comment ? ctx.loaders.posts.load(comment.postId) : null;
      },
      comment: (r: { targetType: string; targetId: string }, _: unknown, ctx: Ctx) => (r.targetType === 'COMMENT' ? ctx.loaders.comments.load(r.targetId) : null),
      resolvedBy: () => null,
    },
  };
}
