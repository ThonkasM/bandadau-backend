import { ListGroupsInternalUseCase } from '../../src/use-cases/groups/group.use-cases';
import type { GroupRepository } from '../../src/use-cases/ports/group.repository';

const snapshot = (id: string) => ({ snapshot: { id } });

function repo(): { port: GroupRepository; calls: string[] } {
  const calls: string[] = [];
  const port = {
    listPublicByCareer: async (career: string, limit: number, offset: number) => {
      calls.push(`career:${career}:${limit}:${offset}`);
      return [snapshot('by-career')];
    },
    listLargestPublic: async (limit: number, offset: number) => {
      calls.push(`largest:${limit}:${offset}`);
      return [snapshot('largest')];
    },
  } as unknown as GroupRepository;
  return { port, calls };
}

describe('ListGroupsInternalUseCase', () => {
  it('filters by career when one is given', async () => {
    const { port, calls } = repo();
    const out = await new ListGroupsInternalUseCase(port).execute({ career: 'Ingeniería de Sistemas', limit: 5 });
    expect(calls).toEqual(['career:Ingeniería de Sistemas:5:0']);
    expect(out[0]?.group).toMatchObject({ id: 'by-career' });
  });

  it('returns the largest public groups when no career is given (contract)', async () => {
    const { port, calls } = repo();
    const out = await new ListGroupsInternalUseCase(port).execute({ limit: 10, offset: 20 });
    expect(calls).toEqual(['largest:10:20']);
    expect(out).toHaveLength(1);
    expect(out[0]?.group).toMatchObject({ id: 'largest' });
  });
});
