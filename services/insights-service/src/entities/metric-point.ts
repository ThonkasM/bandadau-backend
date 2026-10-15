export const METRIC_NAMES = [
  'activeUsers',
  'newUsers',
  'posts',
  'comments',
  'reactions',
  'registrationsConfirmed',
  'registrationsFailed',
  'registrationsCancelled',
  'creditsToppedUp',
  'creditsSpent',
  'creditsRefunded',
  'flaggedContent',
  'sagaCompensations',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface MetricPoint {
  name: MetricName;
  /** yyyy-mm-dd (UTC). */
  date: string;
  value: number;
}
export interface MetricDelta {
  name: MetricName;
  date: string;
  amount: number;
}
