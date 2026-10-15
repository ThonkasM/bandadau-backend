import type { ModerationPort, ModerationVerdict } from '../../../use-cases/ports';

export type ModerationMode = 'allow-all' | 'manual';

/** Phase 1 `ModerationPort`: no classifiers. `allow-all` approves, `manual` sends everything to the moderators' queue. */
export class Phase1ModerationAdapter implements ModerationPort {
  constructor(private readonly mode: ModerationMode) {}

  moderate(): Promise<ModerationVerdict> {
    if (this.mode === 'manual') {
      return Promise.resolve({ model: 'phase1-manual', modelVersion: '1.0.0', decision: 'REVIEW', labels: ['manual_review'], scores: { manual_review: 0.5 } });
    }
    return Promise.resolve({ model: 'phase1-allow-all', modelVersion: '1.0.0', decision: 'ALLOW', labels: [], scores: {} });
  }
}
