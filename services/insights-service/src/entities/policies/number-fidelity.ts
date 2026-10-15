import type { ReportDataset } from '../report';

/** Numbers like `1 284`, `1,284`, `1.284`, `12.5`, `-3`, `38%`. Dates are stripped first. */
const DATE_RE = /\b\d{4}-\d{2}(?:-\d{2})?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}\b/g;
const NUM_RE = /(?<![\w.])-?\d{1,3}(?:[ ,.\u00a0\u202f]\d{3})+(?:[.,]\d+)?|(?<![\w.])-?\d+(?:[.,]\d+)?/g;

/** Parses a number written in Spanish/English style; thousands separators are removed. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\u00a0\u202f ]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const isThousands = parts.length > 2 || (parts.length === 2 && (parts[1] as string).length === 3 && (parts[0] as string).replace('-', '').length <= 3);
    s = isThousands ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function extractNumbers(text: string): number[] {
  const cleaned = text.replace(DATE_RE, ' ');
  const out: number[] = [];
  for (const m of cleaned.matchAll(NUM_RE)) {
    const n = parseNumber(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function collectNumericLeaves(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) into.push(value);
  else if (typeof value === 'string') {
    // numeric strings and numbers embedded in tool text count as evidence
    for (const n of extractNumbers(value)) into.push(n);
  } else if (Array.isArray(value)) for (const v of value) collectNumericLeaves(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumericLeaves(v, into);
  return into;
}

export interface FidelityResult {
  ok: boolean;
  /** Numbers in the text that are not backed by the data. */
  unsupported: number[];
}

const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= Math.abs(b) * 0.01;

/**
 * A2: every figure of the Markdown must exist in the dataset or in a tool result (1 % rounding tolerance).
 * Also accepts sums/averages per dataset column and the row count, which the prompt allows ("sumas simples").
 */
export function checkNumberFidelity(markdown: string, dataset: ReportDataset | null, toolResults: unknown[]): FidelityResult {
  const evidence: number[] = [];
  for (const r of toolResults) collectNumericLeaves(r, evidence);
  if (dataset) {
    dataset.columns.forEach((_, c) => {
      const col = dataset.rows.map((r) => r[c]).filter((v): v is number => typeof v === 'number');
      for (const n of col) evidence.push(n);
      if (col.length > 0) {
        const sum = col.reduce((a, b) => a + b, 0);
        evidence.push(sum, sum / col.length, Math.max(...col), Math.min(...col));
        // period-over-period change in percent
        for (let i = 1; i < col.length; i++) {
          const prev = col[i - 1] as number;
          if (prev !== 0) evidence.push(((((col[i] as number) - prev) / Math.abs(prev)) * 100));
        }
      }
    });
    evidence.push(dataset.rows.length, dataset.columns.length);
    for (const row of dataset.rows) for (const cell of row) if (typeof cell === 'string') evidence.push(...extractNumbers(cell));
  }
  const unsupported = extractNumbers(markdown).filter((n) => !evidence.some((e) => close(n, e) || close(Math.abs(n), Math.abs(e))));
  return { ok: unsupported.length === 0, unsupported };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Output filter (guardrail 9): masks emails and UUIDs in generated text. */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(UUID_RE, '[id]');
}
