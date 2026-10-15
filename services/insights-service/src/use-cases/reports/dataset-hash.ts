import { createHash } from 'node:crypto';

import { canonicalJson } from '../../entities/policies/chart-spec';
import type { ReportDataset } from '../../entities/report';

/** SHA-256 over the canonical JSON of the dataset: detects any later change to the evidence behind a report. */
export function hashDataset(dataset: ReportDataset): string {
  return createHash('sha256').update(canonicalJson(dataset)).digest('hex');
}
