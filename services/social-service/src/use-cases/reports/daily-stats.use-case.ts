import { DomainError } from '../../entities/errors/domain-error';
import type { ContentStatsRepository, DailyContentStats } from '../ports';

export interface ContentDailyStatsOutput {
  from: string;
  to: string;
  days: DailyContentStats[];
  topHashtags: Array<{ hashtag: string; count: number }>;
}

const DAY = 86_400_000;
const MAX_DAYS = 366;
const day = (d: Date): string => d.toISOString().slice(0, 10);

export class GetContentDailyStatsUseCase {
  constructor(private readonly stats: ContentStatsRepository) {}

  async execute(input: { from: string; to: string; topHashtags: number }): Promise<ContentDailyStatsOutput> {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new DomainError('VALIDATION_FAILED', { field: 'to', code: 'INVALID_VALUE' });
    const span = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (span > MAX_DAYS) throw new DomainError('VALIDATION_FAILED', { field: 'to', code: 'INVALID_VALUE' });
    const toExclusive = new Date(to.getTime() + DAY);
    const [rows, topHashtags] = await Promise.all([
      this.stats.daily(from, toExclusive),
      input.topHashtags > 0 ? this.stats.topHashtags(from, toExclusive, input.topHashtags) : Promise.resolve([]),
    ]);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const days: DailyContentStats[] = [];
    for (let i = 0; i < span; i++) {
      const date = day(new Date(from.getTime() + i * DAY));
      days.push(byDate.get(date) ?? { date, postsCreated: 0, commentsCreated: 0, reactionsSet: 0, followsCreated: 0, activeAuthors: 0, postsHidden: 0 });
    }
    return { from: input.from, to: input.to, days, topHashtags };
  }
}
