import type { ProfileRepository } from '../../src/use-cases/ports';
import { GetProfileNamesUseCase } from '../../src/use-cases/profiles/profile.use-cases';

const profile = (userId: string, displayName: string) => ({ snapshot: { userId, displayName, bio: 'secret' } });

describe('GetProfileNamesUseCase', () => {
  it('returns only userId and displayName, deduplicates ids and omits unknown ones', async () => {
    const asked: string[][] = [];
    const repo = {
      findByIds: async (ids: readonly string[]) => {
        asked.push([...ids]);
        return ids.filter((i) => i !== 'missing').map((i) => profile(i, `name-${i}`));
      },
    } as unknown as ProfileRepository;
    const out = await new GetProfileNamesUseCase(repo).execute({ userIds: ['a', 'b', 'a', 'missing'] });
    expect(asked).toEqual([['a', 'b', 'missing']]);
    expect(out).toEqual([
      { userId: 'a', displayName: 'name-a' },
      { userId: 'b', displayName: 'name-b' },
    ]);
  });

  it('does not touch the repository with no ids and caps at 50', async () => {
    let calls = 0;
    let size = 0;
    const repo = { findByIds: async (ids: readonly string[]) => { calls++; size = ids.length; return []; } } as unknown as ProfileRepository;
    const uc = new GetProfileNamesUseCase(repo);
    expect(await uc.execute({ userIds: [] })).toEqual([]);
    expect(calls).toBe(0);
    await uc.execute({ userIds: Array.from({ length: 80 }, (_, i) => `u${i}`) });
    expect(size).toBe(50);
  });
});
