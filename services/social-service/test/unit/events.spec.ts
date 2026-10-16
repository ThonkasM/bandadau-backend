import { SocialEvents } from '../../src/use-cases/events';

const now = new Date('2026-10-15T12:00:00Z');
const A = '0192f1a2-3b4c-7d5e-8f60-718293a4b5c6';
const B = '0192f1a2-3b4c-7d5e-8f60-718293a4b5c7';

describe('SocialEvents actorDisplayName (AsyncAPI 1.3.0)', () => {
  it('follow.created carries the actor name when known and omits it otherwise', () => {
    expect(SocialEvents.followCreated(A, B, now, 'Lucía Mamani').data).toMatchObject({ followerId: A, followeeId: B, actorDisplayName: 'Lucía Mamani' });
    expect(SocialEvents.followCreated(A, B, now).data).not.toHaveProperty('actorDisplayName');
  });
});
