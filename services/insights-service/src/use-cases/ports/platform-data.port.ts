import type { HealthSnapshot } from '../../entities/policies/monitoring-rules';

export interface CallCtx {
  actorId?: string;
  correlationId?: string;
  locale?: string;
}

export interface RegistrationStatsOut {
  from: string;
  to: string;
  groupBy: 'day' | 'event' | 'status';
  rows: { key: string; label?: string; confirmed: number; failed: number; cancelled: number; pending?: number }[];
  totals: { confirmed: number; failed: number; cancelled: number; pending: number };
}
export interface ListEventsOut {
  truncated: boolean;
  items: { eventId: string; title: string; startsAt: string; venue: string; capacity: number; seatsTaken: number; priceCredits: number; status: string }[];
}
export interface CreditStatsOut {
  from: string;
  to: string;
  groupBy: 'day' | 'week' | 'month';
  totals: {
    topUpCount: number;
    topUpCredits: number;
    debitCount: number;
    debitCredits: number;
    refundCount: number;
    refundCredits: number;
    netCredits: number;
    circulatingCredits?: number;
  };
  series: { date: string; topUpCredits: number; debitCredits: number; refundCredits: number }[];
}
export interface ContentStatsOut {
  from: string;
  to: string;
  totals: { posts: number; comments: number; reactions: number };
  reactionsByType: { LIKE: number; HELPFUL: number; FUNNY: number; SUPPORT: number };
  daily: { date: string; posts: number; comments: number; reactions: number }[];
  topHashtags: { hashtag: string; count: number }[];
}
export interface FlaggedContentOut {
  totalPending: number;
  oldestEnqueuedAt: string | null;
  items: { id: string; source: 'AI' | 'REPORTS'; kind: 'IMAGE' | 'VIDEO' | 'POST'; authorId: string; maxScore?: number | null; labels?: string[]; openReports?: number; enqueuedAt: string }[];
}
export interface FailedSagasOut {
  count: number;
  byFailureReason: Record<string, number>;
  items: { sagaId: string; registrationId: string; eventId: string; type: 'REGISTRATION' | 'CANCELLATION'; status: 'FAILED' | 'COMPENSATED'; failedStep: string; failureReason: string; updatedAt: string }[];
}
export interface ServiceHealthOut extends HealthSnapshot {
  checkedAt: string;
  overall: 'UP' | 'DEGRADED' | 'DOWN';
  services: { name: string; status: 'UP' | 'DEGRADED' | 'DOWN'; latencyMs?: number | null; error?: string | null; checks?: Record<string, string> }[];
}
export interface QueryMetricsOut {
  resultType: 'vector' | 'matrix' | 'scalar';
  series: { labels: Record<string, string>; points: { t: string; v: number | null }[] }[];
  truncated: boolean;
  executedAt: string;
}

/** Read access to the other services' `/internal/v1` APIs, RabbitMQ management and Prometheus. */
export interface PlatformDataPort {
  registrationStats(ctx: CallCtx, q: { from: string; to: string; groupBy: 'day' | 'event' | 'status'; eventId?: string }): Promise<RegistrationStatsOut>;
  listEvents(ctx: CallCtx, q: { from: string; to: string; status?: string; limit: number }): Promise<ListEventsOut>;
  creditStats(ctx: CallCtx, q: { from: string; to: string; groupBy: 'day' | 'week' | 'month' }): Promise<CreditStatsOut>;
  contentStats(ctx: CallCtx, q: { from: string; to: string; topHashtags: number }): Promise<ContentStatsOut>;
  flaggedContent(ctx: CallCtx, q: { source: 'AI' | 'REPORTS' | 'ALL'; limit: number }): Promise<FlaggedContentOut>;
  failedSagas(ctx: CallCtx, q: { status?: 'FAILED' | 'COMPENSATED'; since?: string; limit: number }): Promise<FailedSagasOut>;
  serviceHealth(ctx: CallCtx, q: { includeQueues: boolean }): Promise<ServiceHealthOut>;
  queryMetrics(ctx: CallCtx, q: { query: string; start?: string; end?: string; step?: string }): Promise<QueryMetricsOut>;
}
export const PLATFORM_DATA = Symbol('PlatformDataPort');
