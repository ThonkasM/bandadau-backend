export const FEED_WINDOW_HOURS = 72;

/** Phase 1 score: recency only, in [0, 1] (1 = just published, 0 = at or beyond the 72 h window). */
export function recencyScore(createdAt: Date, now: Date, windowHours = FEED_WINDOW_HOURS): number {
  const ageHours = (now.getTime() - createdAt.getTime()) / 3_600_000;
  if (ageHours <= 0) return 1;
  return Math.max(0, Math.round((1 - ageHours / windowHours) * 1000) / 1000);
}
