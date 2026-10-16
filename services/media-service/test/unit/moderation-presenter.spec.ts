import type { ModerationResult } from '../../src/entities/media-asset.entity';
import { presentModerationResult } from '../../src/interface-adapters/presenters/media.presenter';

const base: ModerationResult = { model: 'nsfw-classifier', modelVersion: 'nsfw-classifier@1.0.0', labels: [], scores: { nsfw: 0.2 }, decision: 'ALLOW', frameIndex: null, createdAt: new Date('2026-10-15T10:00:00Z') };

describe('presentModerationResult', () => {
  it('image: a single score, no frame scores', () => {
    expect(presentModerationResult(base)).toMatchObject({ frameScores: null, worstFrameIndex: null, frameIndex: null, scores: { nsfw: 0.2 } });
  });

  it('video: exposes frameScores and worstFrameIndex', () => {
    const frameScores = [
      { index: 0, timestampSeconds: 0, nsfw: 0.1 },
      { index: 1, timestampSeconds: 2, nsfw: 0.7 },
    ];
    expect(presentModerationResult({ ...base, frameScores, frameIndex: 1 })).toMatchObject({ frameScores, worstFrameIndex: 1, frameIndex: 1 });
  });

  it('legacy documents (plain numbers) are normalised and the worst frame is derived', () => {
    const r = presentModerationResult({ ...base, frameScores: [0.1, 0.9, 0.3] });
    expect(r.frameScores).toEqual([
      { index: 0, timestampSeconds: 0, nsfw: 0.1 },
      { index: 1, timestampSeconds: 2, nsfw: 0.9 },
      { index: 2, timestampSeconds: 4, nsfw: 0.3 },
    ]);
    expect(r.worstFrameIndex).toBe(1);
  });
});
