import { toUserErrors } from '../../common/errors';
import { clampFirst, decodeOffset, encodeOffset } from '../../common/relay';
import type { DataSources } from '../../data-sources/data-sources';
import type { ModeratedMedia, ModerationPost, Page } from '../../data-sources/types';
import type { GatewayContext } from '../../graphql/context';
import { itemFromMedia, itemFromPost, mediaModel, type ModerationItemModel, reportModel } from './moderation.mappers';

const MAX_PAGES = 5;

async function collect<T>(fetchPage: (cursor?: string) => Promise<Page<T>>, need: number): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES && out.length < need; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export class ModerationService {
  constructor(private readonly ds: DataSources) {}

  /** Flagged media + hidden posts, oldest first, offset cursors (the two sources have independent cursors). */
  async queue(
    ctx: GatewayContext,
    args: { filter?: { source?: 'AI' | 'REPORTS' | null; kind?: string | null; minScore?: number | null } | null; after?: string | null; first?: number | null },
  ) {
    const first = clampFirst(args.first);
    const offset = decodeOffset(args.after);
    const need = offset + first + 1;
    const f = args.filter ?? {};

    const [media, posts] = await Promise.all([
      f.source === 'REPORTS' ? Promise.resolve<ModeratedMedia[]>([]) : collect((c) => this.ds.media.listFlagged(ctx.call, { cursor: c, limit: 50 }), need),
      f.source === 'AI' || f.kind ? Promise.resolve<ModerationPost[]>([]) : collect((c) => this.ds.social.listPostsByStatus(ctx.call, { cursor: c, limit: 50 }), need),
    ]);

    let items: ModerationItemModel[] = [...media.map(itemFromMedia), ...posts.map(itemFromPost)];
    if (f.kind) items = items.filter((i) => i.media?.kind === f.kind);
    if (f.minScore !== null && f.minScore !== undefined) items = items.filter((i) => (i.media?.moderation?.maxScore ?? 0) >= (f.minScore as number));
    items.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));

    const slice = items.slice(offset, offset + first);
    const hasNext = items.length > offset + first;
    const edges = slice.map((node, i) => ({ cursor: encodeOffset(offset + i + 1), node }));
    return {
      edges,
      pageInfo: {
        hasNextPage: hasNext,
        hasPreviousPage: offset > 0,
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
      totalCount: items.length,
    };
  }

  /** Current pending count (used by the subscription payload). */
  async pendingCount(ctx: GatewayContext): Promise<number> {
    const [m, p] = await Promise.all([
      this.ds.media.listFlagged(ctx.call, { limit: 100 }).then((r) => r.items.length),
      this.ds.social.listPostsByStatus(ctx.call, { limit: 100 }).then((r) => r.items.length),
    ]);
    return m + p;
  }

  async contentReports(ctx: GatewayContext, args: { status?: string | null; targetType?: string | null; first?: number | null }) {
    const first = clampFirst(args.first, 50, 50);
    const page = await this.ds.social.listReports(ctx.call, { status: args.status ?? 'OPEN', limit: first });
    return page.items.filter((r) => !args.targetType || r.targetType === args.targetType).map(reportModel);
  }

  async moderateMedia(ctx: GatewayContext, args: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string | null }) {
    try {
      const media = await this.ds.media.decide(ctx.call, args.id, { decision: args.decision, ...(args.note ? { note: args.note } : {}) });
      return { media: mediaModel(media), errors: [] };
    } catch (e) {
      return { media: null, errors: toUserErrors(e) };
    }
  }

  async resolveReport(ctx: GatewayContext, input: { reportId: string; resolution: string; note?: string | null }) {
    try {
      const report = await this.ds.social.resolveReport(ctx.call, input.reportId, { resolution: input.resolution, ...(input.note ? { note: input.note } : {}) });
      return { report: reportModel(report), errors: [] };
    } catch (e) {
      return { report: null, errors: toUserErrors(e) };
    }
  }
}
