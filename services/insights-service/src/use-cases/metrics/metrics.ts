import { ValidationError } from '../../entities/errors/domain-errors';
import type { MetricDelta, MetricName } from '../../entities/metric-point';
import { METRIC_NAMES } from '../../entities/metric-point';
import type { AnomalyPoint, SeriesPoint } from '../../entities/policies/stat-anomaly';
import type { AnomalyDetector } from '../ports/misc';
import type { AlertRepository, MetricRepository } from '../ports/repositories';

const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRange(from: string, to: string): void {
  const errors: { field: string; code: string; message: string }[] = [];
  for (const [field, v] of [['from', from], ['to', to]] as const) {
    if (!DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) errors.push({ field, code: 'INVALID_FORMAT', message: `${field} must be YYYY-MM-DD` });
  }
  if (errors.length === 0) {
    if (from > to) errors.push({ field: 'from', code: 'OUT_OF_RANGE', message: 'from must not be after to' });
    else if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY > MAX_RANGE_DAYS) {
      errors.push({ field: 'to', code: 'OUT_OF_RANGE', message: `range must not exceed ${MAX_RANGE_DAYS} days` });
    }
  }
  if (errors.length > 0) throw new ValidationError(errors.map((e) => e.message).join('; '), errors);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** ACL: domain event (CloudEvent type + data) -> daily metric increments. Unknown types project nothing. */
export function projectDomainEvent(type: string, data: Record<string, unknown>, timeIso: string): MetricDelta[] {
  const date = timeIso.slice(0, 10);
  const one = (name: MetricName, amount = 1): MetricDelta => ({ name, date, amount });
  const credits = typeof data.amountCredits === 'number' ? data.amountCredits : 0;
  switch (type) {
    case 'bandada.identity.user.registered.v1':
      return [one('newUsers')];
    case 'bandada.social.post.created.v1':
      return [one('posts')];
    case 'bandada.social.comment.created.v1':
      return [one('comments')];
    case 'bandada.social.reaction.set.v1':
      return [one('reactions')];
    case 'bandada.social.content.reported.v1':
    case 'bandada.media.asset.flagged.v1':
      return [one('flaggedContent')];
    case 'bandada.events.registration.confirmed.v1':
      return [one('registrationsConfirmed')];
    case 'bandada.events.registration.failed.v1':
      return [one('registrationsFailed')];
    case 'bandada.events.registration.cancelled.v1':
      return [one('registrationsCancelled')];
    case 'bandada.wallet.topup.paid.v1':
      return credits > 0 ? [one('creditsToppedUp', credits)] : [];
    case 'bandada.wallet.credits-debited.v1':
      return credits > 0 ? [one('creditsSpent', credits)] : [];
    case 'bandada.wallet.credits-refunded.v1':
      return [...(credits > 0 ? [one('creditsRefunded', credits)] : []), one('sagaCompensations')];
    case 'bandada.ticketing.ticket-issue-failed.v1':
      return [one('sagaCompensations')];
    default:
      return [];
  }
}

const ACTIVITY_TYPES = new Set([
  'bandada.social.post.created.v1',
  'bandada.social.comment.created.v1',
  'bandada.social.reaction.set.v1',
  'bandada.events.registration.confirmed.v1',
  'bandada.wallet.topup.paid.v1',
]);
/** The user whose activity counts towards `activeUsers` (hashed upstream is not needed: only a per-day marker is stored). */
export function activeActor(type: string, data: Record<string, unknown>): string | null {
  if (!ACTIVITY_TYPES.has(type)) return null;
  const id = data.authorId ?? data.userId ?? data.actorId;
  return typeof id === 'string' ? id : null;
}

export interface PlatformKpisOut {
  from: string;
  to: string;
  activeUsers: number;
  newUsers: number;
  posts: number;
  comments: number;
  reactions: number;
  registrationsConfirmed: number;
  registrationsFailed: number;
  registrationsCancelled: number;
  creditsToppedUp: number;
  creditsSpent: number;
  flaggedContent: number;
  openAlerts: number;
  series: { date: string; activeUsers: number; posts: number; registrationsConfirmed: number; creditsSpent: number }[];
}

export class GetPlatformKpisUseCase {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly alerts: AlertRepository,
  ) {}

  async execute(from: string, to: string): Promise<PlatformKpisOut> {
    validateRange(from, to);
    const byName = new Map<MetricName, Map<string, number>>();
    await Promise.all(
      METRIC_NAMES.map(async (name) => {
        byName.set(name, new Map((await this.metrics.series(name, from, to)).map((p) => [p.date, p.value])));
      }),
    );
    const sum = (n: MetricName) => [...(byName.get(n)?.values() ?? [])].reduce((a, b) => a + b, 0);
    const day = (n: MetricName, d: string) => byName.get(n)?.get(d) ?? 0;
    const dates = datesBetween(from, to);
    return {
      from,
      to,
      // distinct users cannot be summed across days: the peak daily value is reported
      activeUsers: Math.max(0, ...(byName.get('activeUsers')?.values() ?? [])),
      newUsers: sum('newUsers'),
      posts: sum('posts'),
      comments: sum('comments'),
      reactions: sum('reactions'),
      registrationsConfirmed: sum('registrationsConfirmed'),
      registrationsFailed: sum('registrationsFailed'),
      registrationsCancelled: sum('registrationsCancelled'),
      creditsToppedUp: sum('creditsToppedUp'),
      creditsSpent: sum('creditsSpent'),
      flaggedContent: sum('flaggedContent'),
      openAlerts: await this.alerts.countOpen(),
      series: dates.map((date) => ({
        date,
        activeUsers: day('activeUsers', date),
        posts: day('posts', date),
        registrationsConfirmed: day('registrationsConfirmed', date),
        creditsSpent: day('creditsSpent', date),
      })),
    };
  }
}

export interface DetectAnomaliesOut {
  modelVersion: string;
  anomalies: { metric: string; at: string; value: number; expected: number; score: number; direction: 'SPIKE' | 'DROP' }[];
}

export class DetectAnomaliesUseCase {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly detector: AnomalyDetector,
  ) {}

  async execute(input: { metrics: MetricName[]; from: string; to: string; sensitivity: number }): Promise<DetectAnomaliesOut> {
    validateRange(input.from, input.to);
    const anomalies: DetectAnomaliesOut['anomalies'] = [];
    for (const metric of input.metrics) {
      const points = await this.metrics.series(metric, input.from, input.to);
      // Zero-fill only inside the span that has data, so a young platform is not read as one long spike.
      const series = fillSpan(points);
      const found: AnomalyPoint[] = await this.detector.detect(metric, series, input.sensitivity);
      for (const a of found) anomalies.push({ metric, at: a.at, value: a.value, expected: a.expected, score: a.score, direction: a.direction });
    }
    anomalies.sort((a, b) => b.score - a.score);
    return { modelVersion: this.detector.modelVersion, anomalies };
  }
}

function fillSpan(points: { date: string; value: number }[]): SeriesPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map(sorted.map((p) => [p.date, p.value]));
  return datesBetween((sorted[0] as { date: string }).date, (sorted[sorted.length - 1] as { date: string }).date).map((date) => ({ date, value: map.get(date) ?? 0 }));
}
