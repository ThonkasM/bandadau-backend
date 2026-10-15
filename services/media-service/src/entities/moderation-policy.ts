import type { ModerationDecision } from './media-asset.entity';

export interface ModerationThresholds {
  /** score >= block -> BLOCK (automatic rejection) */
  block: number;
  /** review <= score < block -> REVIEW (moderators' queue) */
  review: number;
}

export const DEFAULT_THRESHOLDS: ModerationThresholds = { block: 0.85, review: 0.5 };

/** D7: >= 0.85 BLOCK, 0.5-0.85 REVIEW, < 0.5 ALLOW. Pure rule; boundaries are inclusive on the upper bucket. */
export function decide(score: number, t: ModerationThresholds = DEFAULT_THRESHOLDS): ModerationDecision {
  if (score >= t.block) return 'BLOCK';
  if (score >= t.review) return 'REVIEW';
  return 'ALLOW';
}
