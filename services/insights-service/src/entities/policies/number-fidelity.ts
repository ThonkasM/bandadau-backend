import type { ReportDataset } from '../report';
import { dateContext, dateContextNumbers,datePartNumbers } from './relative-dates';

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

/** What the verifier knows besides tool results: the question, today and the arguments of every tool call. */
export interface FidelityContext {
  question?: string;
  today?: string;
  toolCalls?: { name: string; input: Record<string, unknown> }[];
}

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function walk(value: unknown, visit: (v: unknown, key?: string) => void, key?: string): void {
  visit(value, key);
  if (Array.isArray(value)) for (const v of value) walk(v, visit, key);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

/**
 * Numbers that are legitimate without being a tool figure: the question's own numbers, the dates and lengths of the periods
 * (years, day/month numbers, number of days), requested limits, positions ("Top 3", 1.º, "3 eventos": 0..max(limit, array length, 3)).
 * Averages, differences and percentages are NOT here: they must come from the `calculate` tool or a tool field.
 */
export function contextNumbers(ctx: FidelityContext, toolResults: unknown[]): number[] {
  const out: number[] = [];
  if (ctx.question) out.push(...extractNumbers(ctx.question));
  if (ctx.today) out.push(...dateContextNumbers(dateContext(ctx.today)), ...datePartNumbers(ctx.today));
  let rankBound = 3;
  for (const call of ctx.toolCalls ?? []) {
    const dates: string[] = [];
    walk(call.input, (v, key) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.push(v);
        if (key && /limit|top|size|count|max/i.test(key)) rankBound = Math.max(rankBound, Math.min(v, 100));
      } else if (typeof v === 'string' && ISO_DATE_PREFIX.test(v)) {
        dates.push(v);
        out.push(...datePartNumbers(v));
      }
    });
    const stamps = dates.map((d) => Date.parse(d.slice(0, 10) + 'T00:00:00Z')).filter(Number.isFinite);
    if (stamps.length >= 2) {
      const span = Math.round((Math.max(...stamps) - Math.min(...stamps)) / 86_400_000);
      out.push(span, span + 1);
    }
  }
  for (const r of toolResults) {
    walk(r, (v) => {
      if (Array.isArray(v)) rankBound = Math.max(rankBound, Math.min(v.length, 100));
      else if (typeof v === 'string' && ISO_DATE_PREFIX.test(v)) out.push(...datePartNumbers(v));
    });
  }
  for (let i = 0; i <= rankBound; i++) out.push(i);
  return out;
}

/** A2: every figure of the Markdown must exist in the dataset, in a tool result or in the allowed context (1 % rounding tolerance). */
export function checkNumberFidelity(markdown: string, dataset: ReportDataset | null, toolResults: unknown[], ctx: FidelityContext = {}): FidelityResult {
  const evidence: number[] = [];
  for (const r of toolResults) collectNumericLeaves(r, evidence);
  evidence.push(...contextNumbers(ctx, toolResults));
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
  // list markers ("1. ", "2) ") are positions, not figures
  const body = markdown.replace(/^\s*\d{1,2}[.)]\s+/gm, '');
  const unsupported = extractNumbers(body).filter((n) => !evidence.some((e) => close(n, e) || close(Math.abs(n), Math.abs(e))));
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Output filter (guardrail 9): masks emails and UUIDs in generated text. */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(UUID_RE, '[id]');
}

/** "Diego Flores" -> "Diego F." (log masking of buyers' display names; decision of agentes-y-reportes-generativos.md). */
export function maskDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const [first, ...rest] = parts as [string, ...string[]];
  const last = rest[rest.length - 1];
  return last ? `${first} ${[...last][0]}.` : `${[...first][0]}.`;
}

/** Masks every `"displayName":"..."` of a JSON text (tool outputs stored in AgentRun steps / logs). The model still receives the full text. */
export function maskDisplayNamesInJson(text: string): string {
  return text.replace(/("displayName"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, (_m, a: string, name: string, z: string) => `${a}${maskDisplayName(name)}${z}`);
}
