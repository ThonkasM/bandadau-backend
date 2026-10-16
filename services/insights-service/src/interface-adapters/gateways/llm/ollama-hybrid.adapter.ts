import { collectNumericLeaves, extractNumbers } from '../../../entities/policies/number-fidelity';
import type { LlmBlock, LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';
import { textOf } from './common';
import { type OllamaAdapter } from './ollama.adapter';
import { composeFromData, isGeneralQuestion, StubLlmAdapter, toolData, toolInput } from './stub.adapter';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface OllamaHybridOptions {
  ollama: OllamaAdapter;
  /** `stub`: an Ollama error/timeout/invalid output falls back to the deterministic result. `none`: errors propagate (the report fails). */
  fallback: 'stub' | 'none';
  model: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MAX_QUESTION = 500;

/** A date `YYYY-MM-DD` that really exists. */
function validDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * Plans (the model only for OPEN questions) and validates in code. Returns null when the model output is unusable.
 * Tools must be offered, dates real, from <= to, span <= 366 days, at most 6 tools.
 */
export function validatePlan(raw: unknown, offered: Set<string>): { tools: string[]; from: string; to: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Obj;
  if (!validDate(o.from) || !validDate(o.to)) return null;
  const span = (Date.parse(`${o.to}T00:00:00Z`) - Date.parse(`${o.from}T00:00:00Z`)) / DAY;
  if (span < 0 || span > 366) return null;
  if (!Array.isArray(o.tools) || o.tools.length === 0 || o.tools.length > 6) return null;
  const tools = [...new Set(o.tools as unknown[])];
  if (!tools.every((t): t is string => typeof t === 'string' && offered.has(t) && t !== 'raise_alert' && t !== 'generate_report')) return null;
  return { tools, from: o.from, to: o.to };
}

const planSchema = (tools: string[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['tools', 'from', 'to'],
  properties: {
    tools: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', enum: tools } },
    from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
    to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
  },
});
const ANSWER_SCHEMA = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };

// words that may legitimately start with a capital letter in an answer without being data
const COMMON = new Set(
  'hoy ayer el la los las un una en de del por con para se que quien quién quienes cuántos cuántas créditos crédito inscripciones inscripción inscritos usuarios usuario eventos evento ticket tickets entrada utc today yesterday the a an on at in of with for was were is are who top this week month last credits credit registration registrations users user event events spent bought ticket no there hay fue fueron entre between and y'.split(' '),
);

/**
 * A model-written answer is accepted only when it is one short line whose figures AND names all come from the tool data
 * (numbers via the same tolerance as the report fidelity check; capitalized words must appear in the data or be common words).
 */
export function isGroundedAnswer(answer: string, data: Record<string, Obj>): boolean {
  const a = answer.trim();
  if (a.length < 10 || a.length > 500 || /[\n\r#*`<>]/.test(a) || /@/.test(a)) return false;
  const evidence = collectNumericLeaves(Object.values(data));
  const numbersOk = extractNumbers(a).every((n) => evidence.some((e) => e === n || Math.abs(n - e) <= Math.abs(e) * 0.01));
  if (!numbersOk) return false;
  const haystack = JSON.stringify(data).toLowerCase();
  const words = a.replace(/[.,;:()¿?¡!"'«»]/g, ' ').split(/\s+/).filter(Boolean);
  return words.every((w) => {
    if (!/^\p{Lu}/u.test(w)) return true;
    const lw = w.toLowerCase();
    return COMMON.has(lw) || haystack.includes(lw);
  });
}

/**
 * `LLM_PROVIDER=ollama` (small local model, CPU). The model NEVER decides facts:
 *  1. tool choice and date range: deterministic planner (intents + ranges); only OPEN questions ask the model for a plan, which is validated in code;
 *  2. tools run through MCP (the agent loop);
 *  3. the model may rewrite the one-line direct answer from the tool data only; the code verifies figures and names and otherwise keeps the
 *     deterministic answer; audio scripts and alert explanations are deterministic.
 * The reported `model` tells who wrote the answer: `<ollama model>` or `<ollama model>+stub-fallback`/`stub-deterministic-1`.
 */
export class OllamaHybridAdapter implements LlmPort {
  readonly provider = 'ollama';
  private readonly stub = new StubLlmAdapter();

  constructor(private readonly o: OllamaHybridOptions) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (req.purpose === 'collect') return this.collect(req);
    if (req.purpose === 'compose' || req.purpose === 'correct') return this.compose(req);
    return this.stub.complete(req);
  }

  private async collect(req: LlmRequest): Promise<LlmResponse> {
    const stubbed = await this.stub.complete(req);
    const question = (req.meta?.question ?? '').slice(0, MAX_QUESTION);
    const firstTurn = !req.messages.some((m) => m.content.some((b) => b.type === 'tool_result'));
    if (!firstTurn || !isGeneralQuestion(question) || !req.tools?.length) return stubbed;
    const today = req.meta?.today ?? new Date().toISOString().slice(0, 10);
    const offered = new Set(req.tools.map((t) => t.name));
    try {
      const res = await this.o.ollama.complete({
        ...req,
        purpose: 'compose',
        tools: undefined,
        maxTokens: 200,
        system: `You plan data lookups for an admin dashboard. Today is ${today} (UTC). Pick 1 to 6 tools from the enum that answer the question and the inclusive date range (YYYY-MM-DD) it asks about; use the last 30 days if it names none. Tools: ${req.tools.map((t) => `${t.name}: ${t.description.slice(0, 90)}`).join(' | ')}. Reply with JSON only.`,
        messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
        responseSchema: planSchema([...offered].filter((n) => n !== 'raise_alert' && n !== 'generate_report')),
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(textOf(res.content));
      } catch {
        parsed = null;
      }
      const plan = validatePlan(parsed, offered);
      if (!plan) return stubbed; // invalid model plan: the generic deterministic plan
      const range = { from: plan.from, to: plan.to };
      const blocks: LlmBlock[] = plan.tools.flatMap((name, i): LlmBlock[] => {
        const input = toolInput(name, range, today);
        return input ? [{ type: 'tool_use', id: `ollama_plan_${i + 1}`, name, input }] : [];
      });
      if (blocks.length === 0) return stubbed;
      return { ...res, stopReason: 'tool_use', content: blocks, model: `${this.o.model}` };
    } catch (error) {
      if (this.o.fallback === 'none') throw error;
      return stubbed;
    }
  }

  private async compose(req: LlmRequest): Promise<LlmResponse> {
    const data = toolData(req.messages);
    const draft = composeFromData(req.locale, data, { question: req.meta?.question, today: req.meta?.today });
    const deterministic: LlmResponse = {
      stopReason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(draft) }],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: 'stub-deterministic-1',
    };
    const question = (req.meta?.question ?? '').slice(0, MAX_QUESTION);
    if (req.purpose === 'correct' || !question || Object.keys(data).length === 0) return deterministic;
    const facts = JSON.stringify(data).slice(0, 6000);
    const es = req.locale === 'es';
    try {
      const res = await this.o.ollama.complete({
        ...req,
        purpose: 'compose',
        tools: undefined,
        maxTokens: 160,
        system: es
          ? 'Eres el analista de Bandada U. Responde la pregunta en UNA sola oración en español, usando SOLO las cifras y nombres de los datos dados. Sin Markdown, sin listas, sin inventar. Si los datos no alcanzan, dilo.'
          : 'You are the Bandada U analyst. Answer the question in ONE sentence in English, using ONLY the figures and names in the given data. No Markdown, no lists, no invention. If the data is not enough, say so.',
        messages: [{ role: 'user', content: [{ type: 'text', text: `${es ? 'Pregunta' : 'Question'}: ${question}\n${es ? 'Datos' : 'Data'} (JSON): ${facts}\n${es ? 'Borrador verificado' : 'Verified draft'}: ${draft.markdown.split('\n')[0]}` }] }],
        responseSchema: ANSWER_SCHEMA,
      });
      let answer = '';
      try {
        answer = String((JSON.parse(textOf(res.content)) as Obj).answer ?? '').trim();
      } catch {
        answer = '';
      }
      if (!isGroundedAnswer(answer, data)) return { ...deterministic, usage: res.usage, model: `${this.o.model}+stub-fallback` };
      const lines = draft.markdown.split('\n');
      const rest = lines[0]?.startsWith('#') ? lines : lines.slice(1);
      const markdown = [answer, '', ...rest.slice(rest[0] === '' ? 1 : 0)].join('\n');
      return { ...res, stopReason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...draft, markdown }) }], model: this.o.model };
    } catch (error) {
      if (this.o.fallback === 'none') throw error;
      return { ...deterministic, model: `${this.o.model}+stub-fallback` };
    }
  }
}
