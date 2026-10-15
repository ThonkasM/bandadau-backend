/** JSON Schema of the final report (agentes-y-reportes-generativos.md 5.2). */
export const COMPOSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'markdown', 'dataset', 'chartIntent'],
  properties: {
    title: { type: 'string', minLength: 5, maxLength: 140 },
    markdown: { type: 'string', maxLength: 20000 },
    dataset: {
      type: 'object',
      additionalProperties: false,
      required: ['columns', 'rows'],
      properties: {
        columns: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['string', 'integer', 'number', 'date', 'datetime', 'boolean'] },
            },
          },
        },
        rows: { type: 'array', maxItems: 200, items: { type: 'array' } },
      },
    },
    chartIntent: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['line', 'bar', 'arc', 'table'] },
        x: { type: 'string' },
        y: { type: 'string' },
        color: { type: 'string' },
        title: { type: 'string' },
      },
    },
  },
};

export interface ComposedReport {
  title: string;
  markdown: string;
  dataset: { columns: { name: string; label?: string; type: 'string' | 'integer' | 'number' | 'date' | 'datetime' | 'boolean' }[]; rows: (string | number | boolean | null)[][] };
  chartIntent: { type: 'line' | 'bar' | 'arc' | 'table'; x?: string; y?: string; color?: string; title?: string };
}

/** Parses and validates the model output; throws with a short reason on malformed content. */
export function parseComposed(text: string): ComposedReport {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the model output');
  const obj = JSON.parse(trimmed.slice(start, end + 1)) as Partial<ComposedReport>;
  if (typeof obj.title !== 'string' || obj.title.length < 5) throw new Error('missing title');
  if (typeof obj.markdown !== 'string' || obj.markdown.length === 0) throw new Error('missing markdown');
  const ds = obj.dataset;
  if (!ds || !Array.isArray(ds.columns) || !Array.isArray(ds.rows)) throw new Error('missing dataset');
  if (ds.columns.some((c) => typeof c?.name !== 'string')) throw new Error('invalid dataset columns');
  if (ds.rows.length > 200) ds.rows = ds.rows.slice(0, 200);
  const intent = obj.chartIntent ?? { type: 'table' as const };
  if (!['line', 'bar', 'arc', 'table'].includes(intent.type)) throw new Error('invalid chartIntent');
  return { title: obj.title, markdown: obj.markdown, dataset: ds, chartIntent: intent };
}
