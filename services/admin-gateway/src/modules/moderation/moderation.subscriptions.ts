import type { GatewayContext } from '../../graphql/context';
import type { BusEvent, RabbitEventBus } from '../../graphql/pubsub/rabbit-event-bus';
import type { ModerationItemModel } from './moderation.mappers';
import type { ModerationService } from './moderation.service';

export const MODERATION_EVENT_TYPES = [
  'bandada.media.asset.flagged.v1',
  'bandada.media.asset.approved.v1',
  'bandada.media.asset.rejected.v1',
  'bandada.social.content.reported.v1',
  'bandada.social.post.hidden.v1',
] as const;

/** Broker bindings of the instance queue (media.asset.#, content.reported, post.hidden). */
export const SUBSCRIPTION_BINDINGS = ['bandada.media.asset.#', 'bandada.social.content.reported.v1', 'bandada.social.post.hidden.v1'];

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export function changeFromEvent(event: BusEvent): { type: 'ADDED' | 'RESOLVED'; item: ModerationItemModel } | null {
  const d = event.data ?? {};
  const at = str(d.occurredAt, event.time ?? new Date().toISOString());

  if (event.type.startsWith('bandada.media.asset.')) {
    const flagged = event.type === 'bandada.media.asset.flagged.v1';
    const status = flagged ? 'FLAGGED' : event.type.endsWith('approved.v1') ? 'APPROVED' : 'REJECTED';
    const scores = (d.scores ?? {}) as Record<string, number>;
    return {
      type: flagged ? 'ADDED' : 'RESOLVED',
      item: {
        id: str(d.mediaId),
        source: 'AI',
        openReports: 0,
        enqueuedAt: at,
        post: null,
        media: {
          id: str(d.mediaId),
          ownerId: str(d.ownerId),
          kind: str(d.kind, 'IMAGE'),
          purpose: 'POST',
          status,
          previewUrl: null,
          thumbnailUrl: null,
          tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
          ocrText: null,
          moderation: flagged
            ? { decision: str(d.decision, 'REVIEW'), labels: (d.labels as string[]) ?? [], scores, maxScore: Number(d.maxScore ?? Math.max(0, ...Object.values(scores))), modelVersion: str(d.modelVersion) }
            : null,
          createdAt: at,
        },
      },
    };
  }

  if (event.type === 'bandada.social.content.reported.v1' || event.type === 'bandada.social.post.hidden.v1') {
    const reported = event.type === 'bandada.social.content.reported.v1';
    const id = str(reported ? d.targetId : d.postId);
    return {
      type: 'ADDED',
      item: {
        id,
        source: 'REPORTS',
        media: null,
        openReports: reported ? Number(d.openReportsCount ?? 1) : 0,
        enqueuedAt: at,
        post: {
          id,
          authorId: str(reported ? d.targetAuthorId : d.authorId),
          text: null,
          hashtags: [],
          visibility: 'PUBLIC',
          status: reported && d.autoHidden !== true ? 'PUBLISHED' : 'HIDDEN',
          mediaIds: [],
          createdAt: at,
        },
      },
    };
  }
  return null;
}

export function moderationSubscriptions(bus: RabbitEventBus, service: ModerationService) {
  return {
    Subscription: {
      moderationQueueChanged: {
        subscribe: async function* (_: unknown, __: unknown, ctx: GatewayContext) {
          for await (const event of bus.iterate(MODERATION_EVENT_TYPES)) {
            const change = changeFromEvent(event);
            if (!change) continue;
            const totalCount = await service.pendingCount(ctx).catch(() => 0);
            yield { moderationQueueChanged: { ...change, totalCount } };
          }
        },
        resolve: (payload: { moderationQueueChanged: unknown }) => payload.moderationQueueChanged,
      },
    },
  };
}
