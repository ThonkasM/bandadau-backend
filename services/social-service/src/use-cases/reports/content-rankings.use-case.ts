import { DomainError } from '../../entities/errors/domain-error';
import type { ContentStatsRepository } from '../ports';

export type RankingBy = 'HASHTAGS' | 'AUTHORS' | 'POSTS';

export interface ContentRankingsOutput {
  from: string;
  to: string;
  by: RankingBy;
  hashtags?: Array<{ hashtag: string; posts: number }>;
  authors?: Array<{ userId: string; posts: number }>;
  posts?: Array<{ postId: string; authorId: string; excerpt: string; reactions: number; comments: number }>;
}

const DAY = 86_400_000;
const MAX_DAYS = 366;
const EXCERPT_LENGTH = 80;

/** Collapses whitespace into a single line and cuts to 80 characters (no ellipsis). */
export const toExcerpt = (text: string): string => Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, EXCERPT_LENGTH).join('');

/** Hashtag / author / post rankings over PUBLISHED posts in a UTC date range. Only the list for `by` is filled. */
export class GetContentRankingsUseCase {
  constructor(private readonly stats: ContentStatsRepository) {}

  async execute(input: { from: string; to: string; by: RankingBy; limit: number }): Promise<ContentRankingsOutput> {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new DomainError('VALIDATION_FAILED', { field: 'to', code: 'INVALID_VALUE' });
    if (Math.round((to.getTime() - from.getTime()) / DAY) + 1 > MAX_DAYS) throw new DomainError('VALIDATION_FAILED', { field: 'to', code: 'INVALID_VALUE' });
    const toExclusive = new Date(to.getTime() + DAY);
    const base = { from: input.from, to: input.to, by: input.by };
    switch (input.by) {
      case 'HASHTAGS':
        return { ...base, hashtags: await this.stats.rankHashtags(from, toExclusive, input.limit) };
      case 'AUTHORS':
        return { ...base, authors: await this.stats.rankAuthors(from, toExclusive, input.limit) };
      case 'POSTS': {
        const rows = await this.stats.rankPosts(from, toExclusive, input.limit);
        return { ...base, posts: rows.map((r) => ({ postId: r.postId, authorId: r.authorId, excerpt: toExcerpt(r.text), reactions: r.reactions, comments: r.comments })) };
      }
    }
  }
}
