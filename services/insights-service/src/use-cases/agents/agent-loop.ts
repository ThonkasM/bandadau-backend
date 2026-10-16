import { type AgentRun, type AgentRunStep, noteEngine } from '../../entities/agent-run';
import { AgentStepLimitError, LlmRefusalError } from '../../entities/errors/domain-errors';
import type { Locale } from '../../entities/locale';
import { type AgentGuardrails, assertBudget, costMicros } from '../../entities/policies/agent-guardrails';
import { maskDisplayNamesInJson } from '../../entities/policies/number-fidelity';
import type { LlmBlock, LlmMessage, LlmPort, LlmPricing, LlmToolDef } from '../ports/llm.port';
import type { McpClientPort } from '../ports/mcp-client.port';
import type { Clock } from '../ports/misc';
import type { AgentRunRepository } from '../ports/repositories';

export const TOOL_RESULT_MAX_CHARS = 12_000;
export const TOOL_TIMEOUT_MS = 15_000;
const SUMMARY_MAX = 2_000;

export interface LoopInput {
  run: AgentRun;
  locale: Locale;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  limits: AgentGuardrails;
  mcp: McpClientPort;
  meta?: { question?: string; today?: string };
  /** Output budget of every LLM call of the loop (default 4096; Q&A mode uses ~500). */
  maxOutputTokens?: number;
  /** Names the agent may call even when only a routed subset is offered to the model (default: the offered tools). */
  allowedNames?: string[];
}
export interface LoopOutput {
  messages: LlmMessage[];
  /** Parsed structured results of every successful tool call (evidence for the fidelity check). */
  toolResults: unknown[];
  /** Name and arguments of every successful tool call (dates, limits: context of the fidelity check). */
  toolCalls: { name: string; input: Record<string, unknown> }[];
}

/** Tool definitions without prose that the model does not need (descriptions are cut; keeps the schema shape the adapters validate). */
export function compactTool(t: LlmToolDef): LlmToolDef {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'description' && typeof x === 'string') out[k] = x.length > 70 ? `${x.slice(0, 67)}...` : x;
        else if (k === 'examples' || k === 'title' || k === '$schema' || k === 'default') continue;
        else out[k] = strip(x);
      }
      return out;
    }
    return v;
  };
  return { name: t.name, description: t.description.length > 180 ? `${t.description.slice(0, 177)}...` : t.description, inputSchema: strip(t.inputSchema) as Record<string, unknown> };
}

const MAX_ARRAY = 40;
/** What the model needs from a tool result: no nulls, short arrays (the count says how many were omitted), figures rounded to 2 decimals. */
export function compactResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map(compactResult);
    return value.length > MAX_ARRAY ? [...items, `…+${value.length - MAX_ARRAY} more`] : items;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      out[k] = compactResult(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isInteger(value)) return Math.round(value * 100) / 100;
  return value;
}

const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));

interface CachedCall {
  content: string;
  isError: boolean;
  structured: unknown;
}

const wrap = (tool: string, content: string) => `<tool_data source="${tool}">${content}</tool_data>`;

/**
 * Common agentic loop (agentes-y-reportes-generativos.md 4.1): at most `maxSteps` LLM calls; every tool call goes through the
 * MCP client, results come back wrapped in `<tool_data>` (A6) and in ONE user message; every step is persisted in the AgentRun.
 */
export class AgentLoop {
  constructor(
    private readonly llm: LlmPort,
    private readonly runs: AgentRunRepository,
    private readonly clock: Clock,
    private readonly pricing: LlmPricing,
  ) {}

  async run(input: LoopInput): Promise<LoopOutput> {
    const { run, limits } = input;
    const messages = [...input.messages];
    const toolResults: unknown[] = [];
    const calledTools: { name: string; input: Record<string, unknown> }[] = [];
    const cache = new Map<string, CachedCall>();
    const offered = input.tools.map(compactTool);
    const allowed = new Set(input.allowedNames ?? input.tools.map((t) => t.name));
    const startedAtMs = this.clock.now().getTime();
    let toolCalls = 0;

    for (;;) {
      try {
        assertBudget(limits, { llmSteps: run.llmSteps, toolCalls, tokens: run.tokens, startedAtMs }, this.clock.now().getTime());
      } catch (error) {
        if (error instanceof AgentStepLimitError) run.stopReason = error.stopReason;
        throw error;
      }
      const t0 = this.clock.now();
      const res = await this.llm.complete({
        tier: 'smart',
        purpose: 'collect',
        locale: input.locale,
        system: input.system,
        messages,
        tools: offered,
        maxTokens: input.maxOutputTokens ?? 4096,
        effort: 'medium',
        meta: input.meta,
        sessionId: run.id,
      });
      noteEngine(run, res);
      run.llmSteps += 1;
      run.llmProvider = this.llm.provider;
      run.model = res.model;
      run.tokens.input += res.usage.inputTokens;
      run.tokens.output += res.usage.outputTokens;
      run.tokens.cacheRead += res.usage.cacheReadTokens;
      run.tokens.cacheWrite += res.usage.cacheWriteTokens;
      run.costUsdMicros += costMicros({ input: res.usage.inputTokens, output: res.usage.outputTokens, cacheRead: 0, cacheWrite: 0 }, this.pricing.inPerM, this.pricing.outPerM);
      await this.record(run, {
        index: run.stepCount + 1,
        kind: 'LLM',
        toolName: null,
        input: null,
        outputSummary: `stop=${res.stopReason} in=${res.usage.inputTokens} out=${res.usage.outputTokens}`,
        isError: false,
        startedAt: t0.toISOString(),
        durationMs: this.clock.now().getTime() - t0.getTime(),
        usage: { input: res.usage.inputTokens, output: res.usage.outputTokens, cacheRead: res.usage.cacheReadTokens, cacheWrite: res.usage.cacheWriteTokens },
      });
      messages.push({ role: 'assistant', content: res.content });

      if (res.stopReason === 'end_turn') return { messages, toolResults, toolCalls: calledTools };
      if (res.stopReason === 'refusal') throw new LlmRefusalError();
      if (res.stopReason !== 'tool_use') {
        run.stopReason = 'MAX_TOKENS';
        throw new AgentStepLimitError('MAX_TOKENS');
      }
      const calls = res.content.filter((b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      toolCalls += calls.length;
      const results = await Promise.all(calls.map((c) => this.executeTool(input, allowed, c, toolResults, calledTools, cache, run)));
      messages.push({ role: 'user', content: results });
    }
  }

  private async executeTool(
    input: LoopInput,
    allowed: Set<string>,
    call: Extract<LlmBlock, { type: 'tool_use' }>,
    toolResults: unknown[],
    calledTools: { name: string; input: Record<string, unknown> }[],
    cache: Map<string, CachedCall>,
    run: AgentRun,
  ): Promise<LlmBlock> {
    const t0 = this.clock.now();
    let content: string;
    let isError = false;
    let cached = false;
    if (!allowed.has(call.name)) {
      content = `Tool ${call.name} is not allowed for this agent.`;
      isError = true;
    } else {
      // same tool + same arguments within the same minute of the same run: answered from memory (no second MCP call)
      const key = `${call.name}|${stable(call.input)}|${Math.floor(t0.getTime() / 60_000)}`;
      const hit = cache.get(key);
      if (hit) {
        ({ content, isError } = hit);
        if (!isError) {
          toolResults.push(hit.structured);
          calledTools.push({ name: call.name, input: call.input });
        }
        cached = true;
      } else {
        try {
          const res = await withTimeout(input.mcp.callTool(call.name, call.input), TOOL_TIMEOUT_MS);
          content = res.content;
          isError = res.isError;
          const structured = res.structured ?? safeParse(res.content);
          if (!isError) {
            toolResults.push(structured);
            calledTools.push({ name: call.name, input: call.input });
            if (structured !== null && typeof structured === 'object') content = JSON.stringify(compactResult(structured));
          }
          cache.set(key, { content, isError, structured });
        } catch (error) {
          content = `Tool call failed: ${(error as Error).message}`;
          isError = true;
        }
      }
    }
    if (!run.toolsUsed.includes(call.name)) run.toolsUsed.push(call.name);
    await this.record(run, {
      index: run.stepCount + 1,
      kind: 'TOOL_CALL',
      toolName: call.name,
      input: call.input,
      outputSummary: `${cached ? '(cached) ' : ''}${maskDisplayNamesInJson(content).slice(0, SUMMARY_MAX)}`,
      isError,
      startedAt: t0.toISOString(),
      durationMs: this.clock.now().getTime() - t0.getTime(),
    });
    let body = content;
    if (body.length > TOOL_RESULT_MAX_CHARS) body = `${body.slice(0, TOOL_RESULT_MAX_CHARS)}…[truncated: narrow the date range or add filters]`;
    return { type: 'tool_result', toolUseId: call.id, content: wrap(call.name, body), isError };
  }

  private async record(run: AgentRun, step: AgentRunStep): Promise<void> {
    run.stepCount = step.index;
    await this.runs.appendStep(run.id, step);
    await this.runs.update(run);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
