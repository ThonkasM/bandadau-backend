export interface SeriesPoint {
  date: string;
  value: number;
}
export interface AnomalyPoint {
  at: string;
  value: number;
  expected: number;
  /** 0..1, higher = more anomalous. */
  score: number;
  direction: 'SPIKE' | 'DROP';
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (pos - lo);
}

export const MIN_POINTS = 7;
const Z_REFERENCE = 3.5;

/**
 * Robust detector (modified z-score on median/MAD, falling back to mean absolute deviation, plus the 3xIQR fence):
 * simple, deterministic stand-in for the ONNX Isolation Forest behind the `AnomalyDetector` port.
 * score = 1 - 1/(1 + (|z|/3.5)^2) so z = 3.5 -> 0.5, z = 7 -> 0.8, z = 35 -> 0.99.
 */
export function detectStatisticalAnomalies(series: SeriesPoint[], sensitivity = 0.8): AnomalyPoint[] {
  if (series.length < MIN_POINTS) return [];
  const values = series.map((p) => p.value);
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  const meanAd = values.reduce((n, v) => n + Math.abs(v - med), 0) / values.length;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const out: AnomalyPoint[] = [];
  for (const p of series) {
    const dev = p.value - med;
    let z: number;
    if (mad > 0) z = (0.6745 * dev) / mad;
    else if (meanAd > 0) z = dev / (1.253314 * meanAd);
    else z = dev === 0 ? 0 : Math.sign(dev) * Infinity;
    const outsideFence = iqr > 0 ? p.value > q3 + 3 * iqr || p.value < q1 - 3 * iqr : dev !== 0;
    if (!outsideFence) continue;
    const az = Math.abs(z);
    const score = Number.isFinite(az) ? 1 - 1 / (1 + (az / Z_REFERENCE) ** 2) : 0.999;
    if (score < sensitivity) continue;
    out.push({ at: p.date, value: p.value, expected: med, score: Math.round(score * 1000) / 1000, direction: dev > 0 ? 'SPIKE' : 'DROP' });
  }
  return out;
}
