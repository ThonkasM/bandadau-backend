import type { DatasetCell, DatasetColumn, ReportDataset } from '../report';
import type { ChartIntent } from './chart-spec';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const MAX_ROWS = 30;
const MAX_COLS = 5;
const DATEISH = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

/** Name of identifiers/text we do not chart (never personal data columns). */
const SKIP_KEYS = /^(id|.*Id|.*Ids|email|phone|token|jti)$/i;
const NAME_KEYS = /^(name|title|label|key|date|day|hashtag|university|career|status|metric|service|queue|displayName)$/i;

function scalarColumns(row: Obj): { key: string; type: DatasetColumn['type'] }[] {
  const out: { key: string; type: DatasetColumn['type'] }[] = [];
  for (const [key, v] of Object.entries(row)) {
    if (SKIP_KEYS.test(key)) continue;
    if (typeof v === 'number') out.push({ key, type: Number.isInteger(v) ? 'integer' : 'number' });
    else if (typeof v === 'string' && v.length <= 80) out.push({ key, type: DATEISH.test(v) ? (v.length > 10 ? 'datetime' : 'date') : 'string' });
  }
  return out;
}

/**
 * The most informative small table the tool results support (Q&A answers written by an agent engine carry no dataset of their own).
 * Looks for the first array of homogeneous objects with at least one numeric field; `null` when there is none.
 */
export function deriveDataset(toolResults: unknown[]): { dataset: ReportDataset; chart: ChartIntent } | null {
  for (const result of toolResults) {
    if (!isObj(result)) continue;
    for (const value of Object.values(result)) {
      if (!Array.isArray(value) || value.length === 0 || !value.every(isObj)) continue;
      const rows = value as Obj[];
      const cols = scalarColumns(rows[0] as Obj);
      const numeric = cols.filter((c) => c.type === 'integer' || c.type === 'number');
      if (numeric.length === 0) continue;
      const label = cols.find((c) => c.type !== 'integer' && c.type !== 'number' && NAME_KEYS.test(c.key)) ?? cols.find((c) => c.type !== 'integer' && c.type !== 'number');
      const picked = [...(label ? [label] : []), ...numeric.filter((c) => c !== label)].slice(0, MAX_COLS);
      const dataset: ReportDataset = {
        columns: picked.map((c) => ({ name: c.key, label: c.key, type: c.type })),
        rows: rows.slice(0, MAX_ROWS).map((r) => picked.map((c): DatasetCell => (r[c.key] as DatasetCell | undefined) ?? null)),
      };
      const firstNumeric = picked.find((c) => c.type === 'integer' || c.type === 'number');
      if (!label || !firstNumeric) return { dataset, chart: { type: 'table' } };
      const temporal = label.type === 'date' || label.type === 'datetime';
      return { dataset, chart: { type: temporal && rows.length >= 3 ? 'line' : 'bar', x: label.key, y: firstNumeric.key, title: firstNumeric.key } };
    }
  }
  return null;
}
