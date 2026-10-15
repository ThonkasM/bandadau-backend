import type { ReportDataset } from '../report';

export type ChartType = 'line' | 'bar' | 'arc' | 'table';
export interface ChartIntent {
  type: ChartType;
  x?: string;
  y?: string;
  color?: string;
  title?: string;
}

const TEMPORAL = new Set(['date', 'datetime']);

/**
 * Builds a Vega-Lite v5 spec WITHOUT colors or fonts (D13): the MFE injects a `config` from @bandada/ui-tokens.
 * Returns null for `table` or when the intent does not match the dataset columns.
 */
export function buildChartSpec(intent: ChartIntent, dataset: ReportDataset): Record<string, unknown> | null {
  if (intent.type === 'table') return null;
  const col = (name?: string) => dataset.columns.find((c) => c.name === name);
  const x = col(intent.x);
  const y = col(intent.y);
  if (!x || !y) return null;
  if (dataset.rows.length === 0) return null;
  const color = intent.color ? col(intent.color) : undefined;
  if (intent.color && !color) return null;
  if (intent.type === 'arc' && dataset.rows.length > 6) return null;

  const label = (c: { name: string; label?: string }) => c.label ?? c.name;
  const xType = TEMPORAL.has(x.type) ? 'temporal' : x.type === 'string' ? (intent.type === 'bar' ? 'ordinal' : 'nominal') : 'ordinal';
  const data = { name: 'dataset' };
  const title = intent.title;

  if (intent.type === 'arc') {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      ...(title ? { title } : {}),
      data,
      mark: { type: 'arc' },
      encoding: {
        theta: { field: y.name, type: 'quantitative', title: label(y) },
        color: { field: x.name, type: 'nominal', title: label(x) },
      },
    };
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    ...(title ? { title } : {}),
    data,
    mark: intent.type === 'line' ? { type: 'line', point: true } : { type: 'bar' },
    encoding: {
      x: { field: x.name, type: xType, title: label(x) },
      y: { field: y.name, type: 'quantitative', title: label(y) },
      ...(color ? { color: { field: color.name, type: 'nominal', title: label(color) } } : {}),
    },
  };
}

/** True if no value in the spec looks like a color or font (design tokens only). */
export function specHasNoStyling(spec: unknown): boolean {
  const text = JSON.stringify(spec);
  return !/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|"fill"|"stroke"|"font|"scale"\s*:\s*\{[^}]*"range"/.test(text);
}

/** Canonical JSON (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
