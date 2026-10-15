/** Subset of `metadata.json` (contract bandadau-ml -> media-service, ml-dl.md §2) that the service relies on. */
export interface ModelMetadata {
  name: string;
  version: string;
  input: { name: string; shape: number[]; layout: 'NCHW'; resize: number; resizeMode?: 'stretch'; mean: number[]; std: number[]; scale?: number };
  output: { name: string; labels: string[]; activation: 'softmax'; positiveLabel: string };
  thresholds: { block: number; review: number };
  artifacts?: Record<string, { file: string; sha256: string }>;
  sha256: string;
}

export function parseMetadata(raw: string): ModelMetadata {
  const m = JSON.parse(raw) as ModelMetadata;
  if (m?.input?.layout !== 'NCHW' || m.input.shape?.length !== 4) throw new Error('metadata.json: input must be NCHW 4-D');
  if (m.input.mean?.length !== 3 || m.input.std?.length !== 3) throw new Error('metadata.json: mean/std must have 3 values');
  if (m.output?.activation !== 'softmax' || !m.output.labels?.includes(m.output.positiveLabel)) throw new Error('metadata.json: unsupported output');
  if (!(m.thresholds?.review <= m.thresholds?.block)) throw new Error('metadata.json: invalid thresholds');
  return m;
}
