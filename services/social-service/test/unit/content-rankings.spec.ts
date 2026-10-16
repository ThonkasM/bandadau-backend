import type { ContentStatsRepository, RankedPost } from '../../src/use-cases/ports';
import { GetContentRankingsUseCase, toExcerpt } from '../../src/use-cases/reports/content-rankings.use-case';

const makeRepo = (posts: RankedPost[] = []) => {
  const calls: string[] = [];
  const repo = {
    rankHashtags: async (from: Date, to: Date, limit: number) => {
      calls.push(`hashtags ${from.toISOString()} ${to.toISOString()} ${limit}`);
      return [{ hashtag: 'bienvenida', posts: 4 }];
    },
    rankAuthors: async () => {
      calls.push('authors');
      return [{ userId: 'u1', posts: 2 }];
    },
    rankPosts: async () => {
      calls.push('posts');
      return posts;
    },
  } as unknown as ContentStatsRepository;
  return { repo, calls };
};

describe('GetContentRankingsUseCase', () => {
  it('fills only the list requested by `by` and queries [from, to+1d)', async () => {
    const { repo, calls } = makeRepo();
    const out = await new GetContentRankingsUseCase(repo).execute({ from: '2026-10-01', to: '2026-10-16', by: 'HASHTAGS', limit: 5 });
    expect(out).toEqual({ from: '2026-10-01', to: '2026-10-16', by: 'HASHTAGS', hashtags: [{ hashtag: 'bienvenida', posts: 4 }] });
    expect(calls).toEqual(['hashtags 2026-10-01T00:00:00.000Z 2026-10-17T00:00:00.000Z 5']);
  });

  it('presents posts with a one-line excerpt of at most 80 characters', async () => {
    const { repo } = makeRepo([{ postId: 'p1', authorId: 'a1', text: `hola\n\n  mundo ${'x'.repeat(100)}`, reactions: 3, comments: 1 }]);
    const out = await new GetContentRankingsUseCase(repo).execute({ from: '2026-10-01', to: '2026-10-01', by: 'POSTS', limit: 5 });
    expect(out.posts).toHaveLength(1);
    expect(out.posts?.[0]?.excerpt).toHaveLength(80);
    expect(out.posts?.[0]?.excerpt.startsWith('hola mundo xxx')).toBe(true);
    expect(out.hashtags).toBeUndefined();
    expect(out.authors).toBeUndefined();
  });

  it('rejects reversed and over-long ranges', async () => {
    const uc = new GetContentRankingsUseCase(makeRepo().repo);
    await expect(uc.execute({ from: '2026-10-02', to: '2026-10-01', by: 'AUTHORS', limit: 5 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(uc.execute({ from: '2025-01-01', to: '2026-10-01', by: 'AUTHORS', limit: 5 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(uc.execute({ from: '2026-01-01', to: '2026-12-31', by: 'AUTHORS', limit: 5 })).resolves.toMatchObject({ by: 'AUTHORS' });
  });

  it('toExcerpt keeps short text as is', () => {
    expect(toExcerpt('  uno   dos ')).toBe('uno dos');
  });
});
