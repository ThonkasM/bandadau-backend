import { decide } from '../../src/entities/moderation-policy';

describe('decide (D7 thresholds)', () => {
  it.each([
    [0, 'ALLOW'],
    [0.4999, 'ALLOW'],
    [0.5, 'REVIEW'],
    [0.8499, 'REVIEW'],
    [0.85, 'BLOCK'],
    [1, 'BLOCK'],
  ])('score %p -> %s', (score, expected) => {
    expect(decide(score)).toBe(expected);
  });

  it('honours custom thresholds (review=0 sends everything to review)', () => {
    expect(decide(0, { block: 0.85, review: 0 })).toBe('REVIEW');
    expect(decide(0.3, { block: 0.2, review: 0 })).toBe('BLOCK');
  });
});
