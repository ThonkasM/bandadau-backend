import type { PlatformDataPort, ServiceHealthOut } from '../../../src/use-cases/ports/platform-data.port';
import { uuid } from './harness';

/** Deterministic platform data (what events/wallet/social/media would answer); `health` can be changed by a test. */
export class FakePlatform implements PlatformDataPort {
  health: ServiceHealthOut = {
    checkedAt: '2026-10-15T12:00:00Z',
    overall: 'UP',
    services: ['identity-service', 'wallet-service', 'events-service'].map((name) => ({ name, status: 'UP' as const, latencyMs: 4 })),
    queues: [{ name: 'events-service.saga-replies.dlq', messagesReady: 0, messagesUnacked: 0, consumers: 0, isDeadLetter: true }],
  };
  readonly calls: string[] = [];
  async registrationStats(_c: unknown, q: { from: string; to: string; groupBy: 'day' | 'event' | 'status' }) {
    this.calls.push('registrationStats');
    return { from: q.from, to: q.to, groupBy: q.groupBy, rows: [{ key: '2026-10-14', confirmed: 4, failed: 1, cancelled: 0, pending: 0 }, { key: '2026-10-15', confirmed: 7, failed: 3, cancelled: 0, pending: 0 }], totals: { confirmed: 11, failed: 4, cancelled: 0, pending: 0 } };
  }
  async listEvents() {
    this.calls.push('listEvents');
    return { truncated: false, items: [{ eventId: uuid(1), title: 'Taller de Git', startsAt: '2026-10-20T10:00:00Z', venue: 'Aula 1', capacity: 30, seatsTaken: 12, priceCredits: 20, status: 'PUBLISHED' }] };
  }
  async creditStats(_c: unknown, q: { from: string; to: string; groupBy: 'day' | 'week' | 'month' }) {
    this.calls.push('creditStats');
    return { from: q.from, to: q.to, groupBy: q.groupBy, totals: { topUpCount: 7, topUpCredits: 500, debitCount: 8, debitCredits: 160, refundCount: 3, refundCredits: 80, netCredits: 420, circulatingCredits: 420 }, series: [{ date: '2026-10-15', topUpCredits: 500, debitCredits: 160, refundCredits: 80 }] };
  }
  async listRecentRegistrations(_c: unknown, q: { status: string; limit: number }) {
    this.calls.push('listRecentRegistrations');
    return {
      truncated: false,
      items: [{ registrationId: uuid(7), ticketId: null, event: { id: uuid(1), title: 'Taller de Git' }, buyer: { userId: uuid(8), displayName: 'Diego Flores' }, creditsPaid: 20, status: q.status, confirmedAt: '2026-10-15T14:32:00Z' }],
    };
  }
  async topCreditSpenders(_c: unknown, q: { from: string; to: string }) {
    this.calls.push('topCreditSpenders');
    return { from: q.from, to: q.to, items: [{ userId: uuid(8), displayName: 'Diego Flores', creditsSpent: 40, registrations: 2 }] };
  }
  async userStats(_c: unknown, q: { from?: string; to?: string }) {
    this.calls.push('userStats');
    return {
      asOf: q.to ?? '2026-10-15',
      totalUsers: 9,
      activeUsers: 7,
      suspendedUsers: 1,
      newUsers: q.from ? 4 : null,
      byStatus: { ACTIVE: 8, SUSPENDED: 1, PENDING_VERIFICATION: 0 },
      byUniversity: [{ universityId: uuid(20), name: 'Universidad Mayor de San Andrés', users: 9 }],
      byCareer: [{ career: 'Ingeniería de Sistemas', users: 4 }],
    };
  }
  async walletOverview() {
    this.calls.push('walletOverview');
    return { creditsInCirculation: 412, walletsWithBalance: 7, averageBalance: 58.86, topBalances: [{ userId: uuid(8), displayName: 'Diego Flores', balanceCredits: 120 }] };
  }
  async ticketStats(_c: unknown, q: { from: string; to: string }) {
    this.calls.push('ticketStats');
    return { from: q.from, to: q.to, issued: 18, used: 5, voided: 2, usageRate: 0.2778, truncated: false, byEvent: [{ eventId: uuid(1), title: 'Taller de Git', issued: 9, used: 4, usageRate: 0.4444 }] };
  }
  async contentRankings(_c: unknown, q: { from: string; to: string; by: 'HASHTAGS' | 'AUTHORS' | 'POSTS' }) {
    this.calls.push('contentRankings');
    return { from: q.from, to: q.to, by: q.by, hashtags: [{ hashtag: 'bandada', posts: 3 }] };
  }
  async eventRanking(_c: unknown, q: { from: string; to: string; by: 'REGISTRATIONS' | 'REVENUE' | 'FILL_RATE' | 'ATTENDANCE' }) {
    this.calls.push('eventRanking');
    return { from: q.from, to: q.to, by: q.by, items: [{ eventId: uuid(1), title: 'Taller de Git', value: 12, registrations: 12, capacity: 30, revenueCredits: 240, usedTickets: null }] };
  }
  async contentStats(_c: unknown, q: { from: string; to: string }) {
    this.calls.push('contentStats');
    return { from: q.from, to: q.to, totals: { posts: 8, comments: 2, reactions: 5 }, reactionsByType: { LIKE: 0, HELPFUL: 0, FUNNY: 0, SUPPORT: 0 }, daily: [{ date: '2026-10-15', posts: 8, comments: 2, reactions: 5 }], topHashtags: [{ hashtag: 'bandada', count: 3 }] };
  }
  async flaggedContent() {
    this.calls.push('flaggedContent');
    return { totalPending: 0, oldestEnqueuedAt: null, items: [] };
  }
  async failedSagas() {
    this.calls.push('failedSagas');
    return { count: 0, byFailureReason: {}, items: [] };
  }
  async serviceHealth() {
    this.calls.push('serviceHealth');
    return this.health;
  }
  async queryMetrics(): Promise<never> {
    throw new Error('not configured');
  }
}
