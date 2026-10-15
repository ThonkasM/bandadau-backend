import type { MetricName } from '../../../entities/metric-point';
import { type AnomalyPoint, detectStatisticalAnomalies, type SeriesPoint } from '../../../entities/policies/stat-anomaly';
import type { AnomalyDetector } from '../../../use-cases/ports/misc';

/** Statistical stand-in (robust z-score + IQR) behind the `AnomalyDetector` port; the ONNX Isolation Forest replaces it later. */
export class StatAnomalyDetector implements AnomalyDetector {
  constructor(readonly modelVersion = 'stat-robust-zscore-1.0.0') {}
  async detect(_metric: MetricName, series: SeriesPoint[], sensitivity: number): Promise<AnomalyPoint[]> {
    return detectStatisticalAnomalies(series, sensitivity);
  }
}
