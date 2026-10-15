import { GraphQLError } from 'graphql';

import type { DataSources } from '../../data-sources/data-sources';
import type { GatewayContext } from '../../graphql/context';
import type { ModerationService } from '../moderation/moderation.service';

export interface DateRangeInput {
  from: string;
  to: string;
  bucket?: 'DAY' | 'WEEK' | 'MONTH' | null;
}

function checkRange(range: DateRangeInput): void {
  if (range.from > range.to) throw new GraphQLError('range.from must not be after range.to', { extensions: { code: 'VALIDATION_FAILED', field: ['range'] } });
}

export class DashboardService {
  constructor(
    private readonly ds: DataSources,
    private readonly moderation: ModerationService,
  ) {}

  async walletStats(ctx: GatewayContext, range: DateRangeInput) {
    checkRange(range);
    const stats = await this.ds.wallet.creditStats(ctx.call, range.from, range.to, (range.bucket ?? 'DAY').toLowerCase() as 'day' | 'week' | 'month');
    return {
      range: { from: stats.from, to: stats.to },
      ...stats.totals,
      circulatingCredits: stats.totals.circulatingCredits ?? null,
      series: stats.series,
    };
  }

  /** Aggregates counters from social, events, wallet, identity and moderation; a failing source degrades to zeros + a partial error. */
  async dashboard(ctx: GatewayContext, range: DateRangeInput) {
    checkRange(range);
    const fail = (component: string) => (error: unknown) => {
      ctx.partialErrors.push(
        new GraphQLError(`dashboard: ${component} unavailable (${(error as Error).message})`, {
          path: ['dashboard'],
          extensions: { code: 'SERVICE_UNAVAILABLE', component, degraded: true },
        }),
      );
      return null;
    };
    const [content, regs, credits, pending, newUsers] = await Promise.all([
      this.ds.social.dailyStats(ctx.call, range.from, range.to).catch(fail('social')),
      this.ds.events.registrationStats(ctx.call, range.from, range.to).catch(fail('events')),
      this.ds.wallet.creditStats(ctx.call, range.from, range.to, 'day').catch(fail('wallet')),
      this.moderation.pendingCount(ctx).catch(fail('moderation')),
      this.countNewUsers(ctx, range).catch(fail('identity')),
    ]);

    const sum = (pick: (d: NonNullable<typeof content>['days'][number]) => number) => (content?.days ?? []).reduce((n, d) => n + pick(d), 0);
    return {
      range: { from: range.from, to: range.to },
      activeUsers: Math.max(0, ...(content?.days ?? []).map((d) => d.activeAuthors)),
      newUsers: newUsers ?? 0,
      posts: sum((d) => d.postsCreated),
      comments: sum((d) => d.commentsCreated),
      reactions: sum((d) => d.reactionsSet),
      registrationsConfirmed: regs?.totals.confirmed ?? 0,
      registrationsFailed: regs?.totals.failed ?? 0,
      registrationsCancelled: regs?.totals.cancelled ?? 0,
      creditsToppedUp: credits?.totals.topUpCredits ?? 0,
      creditsSpent: credits?.totals.debitCredits ?? 0,
      flaggedContent: pending ?? 0,
      openAlerts: 0,
      series: [
        { name: 'postsCreated', points: (content?.days ?? []).map((d) => ({ date: d.date, value: d.postsCreated })) },
        { name: 'registrationsConfirmed', points: (regs?.series ?? []).map((s) => ({ date: s.key, value: s.confirmed })) },
        { name: 'creditsSpent', points: (credits?.series ?? []).map((s) => ({ date: s.date, value: s.debitCredits })) },
      ],
    };
  }

  private async countNewUsers(ctx: GatewayContext, range: DateRangeInput): Promise<number> {
    const from = `${range.from}T00:00:00Z`;
    const to = `${range.to}T23:59:59.999Z`;
    let count = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await this.ds.identity.searchUsers(ctx.call, { cursor, limit: 100 });
      count += res.items.filter((u) => u.createdAt >= from && u.createdAt <= to).length;
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return count;
  }
}
