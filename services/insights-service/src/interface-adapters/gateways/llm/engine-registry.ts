import { LlmUnavailableError } from '../../../entities/errors/domain-errors';
import { Pseudonymizer } from '../../../entities/policies/pseudonymizer';
import type { ConcreteEngine, EngineMode, ReportEngine, ReportEngineInfo } from '../../../entities/report-engine';
import type { LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';
import type { LlmEnginesPort } from '../../../use-cases/ports/llm-engines.port';
import type { AppLogger } from '../../../use-cases/ports/misc';
import { CircuitBreaker } from './circuit-breaker';
import { LlmAuthError, LlmRateLimitedError } from './llm-errors';
import { PseudonymizingLlmAdapter } from './pseudonymizing.adapter';

export type EngineId = 'opencode' | 'claude' | 'ollama' | 'stub';

export interface EngineEntry {
  id: EngineId;
  engine: ConcreteEngine;
  label: string;
  model: string | null;
  mode: EngineMode;
  /** Data leaves the platform: names are pseudonymized before every call. */
  external: boolean;
  adapter: LlmPort;
  /** Cheap reachability/configuration check; must not throw. */
  probe: () => Promise<boolean>;
}

export interface RegistryOptions {
  /** Preference order of AUTO (`LLM_PROVIDERS`). Engines outside the list can still be chosen explicitly. */
  order: EngineId[];
  /** Append the deterministic stub as last resort of AUTO even when it is not listed (`LLM_FALLBACK` is not `none`). */
  stubLastResort: boolean;
  healthTtlMs?: number;
  breakerThreshold?: number;
  breakerOpenMs?: number;
  now?: () => number;
  logger?: AppLogger;
}

export interface Tracked extends EngineEntry {
  breaker: CircuitBreaker;
  health: { ok: boolean; at: number } | null;
}

const FALLBACK_TAG = '+stub-fallback';

/**
 * Strategy/Factory of report engines with a fallback chain (ADR-0022).
 * AUTO = first available of `order`, falling to the next on error, timeout, 429 or invalid output. An explicit engine is used as is and,
 * if it fails, the deterministic STUB answers and the model says so (`glm-5.2+stub-fallback`).
 */
export class LlmEngineRegistry implements LlmEnginesPort {
  private readonly tracked: Tracked[];
  private readonly now: () => number;
  private readonly healthTtlMs: number;

  constructor(entries: EngineEntry[], private readonly o: RegistryOptions) {
    this.now = o.now ?? Date.now;
    this.healthTtlMs = o.healthTtlMs ?? 30_000;
    this.tracked = entries.map((e) => ({ ...e, breaker: new CircuitBreaker(o.breakerThreshold ?? 3, o.breakerOpenMs ?? 60_000, this.now), health: null }));
  }

  /** Healthy right now: cached probe + breaker closed. */
  async isAvailable(e: Tracked): Promise<boolean> {
    if (e.breaker.isOpen) return false;
    const h = e.health;
    if (h && this.now() - h.at < (h.ok ? this.healthTtlMs : Math.min(this.healthTtlMs, 10_000))) return h.ok;
    let ok = false;
    try {
      ok = await e.probe();
    } catch {
      ok = false;
    }
    e.health = { ok, at: this.now() };
    return ok;
  }

  async list(): Promise<ReportEngineInfo[]> {
    const out: ReportEngineInfo[] = [];
    for (const engine of ['OPENCODE', 'OLLAMA', 'STUB'] as const) {
      const candidates = this.tracked.filter((t) => t.engine === engine);
      if (candidates.length === 0) continue;
      let chosen = candidates[0] as Tracked;
      let available = false;
      for (const c of this.ordered(candidates)) {
        if (await this.isAvailable(c)) {
          chosen = c;
          available = true;
          break;
        }
      }
      out.push({ engine, label: chosen.label, model: chosen.model, available, external: chosen.external, mode: chosen.mode });
    }
    return out;
  }

  /** Per-request port: sticky (an engine that failed is not retried within the same request). */
  select(engine: ReportEngine, locale: 'es' | 'en' = 'es'): LlmPort {
    return new EngineChain(this, engine, true, locale);
  }

  /** Long-lived port for background callers (monitoring explanations): AUTO without per-request stickiness. */
  auto(): LlmPort {
    return new EngineChain(this, 'AUTO', false, 'es');
  }

  /** @internal used by the chain */
  ordered<T extends Tracked>(list: T[]): T[] {
    const rank = (e: Tracked) => {
      const i = this.o.order.indexOf(e.id);
      return i < 0 ? 99 : i;
    };
    return [...list].sort((a, b) => rank(a) - rank(b));
  }

  /** @internal */
  async plan(engine: ReportEngine): Promise<Tracked[]> {
    const stub = this.tracked.find((t) => t.engine === 'STUB');
    if (engine === 'AUTO') {
      const listed = this.ordered(this.tracked.filter((t) => this.o.order.includes(t.id)));
      const chain: Tracked[] = [];
      for (const t of listed) if (t.id === 'stub' || (await this.isAvailable(t))) chain.push(t);
      if (stub && this.o.stubLastResort && !chain.includes(stub)) chain.push(stub);
      return chain;
    }
    const wanted = this.ordered(this.tracked.filter((t) => t.engine === engine));
    const chain = wanted.filter((t) => !t.breaker.isOpen);
    if (stub && engine !== 'STUB') chain.push(stub);
    return chain.length > 0 || !stub ? chain : [stub];
  }

  /** @internal */
  tag(e: Tracked): string {
    return e.model ?? e.id;
  }

  get logger(): AppLogger | undefined {
    return this.o.logger;
  }
}

class EngineChain implements LlmPort {
  private readonly failed = new Set<Tracked>();
  private firstFailure: Tracked | null = null;
  private readonly pseudo: Pseudonymizer;
  private last: Tracked | null = null;

  constructor(
    private readonly registry: LlmEngineRegistry,
    private readonly engine: ReportEngine,
    private readonly sticky: boolean,
    private readonly locale: 'es' | 'en',
  ) {
    this.pseudo = new Pseudonymizer(locale);
  }

  get provider(): string {
    return this.last?.id ?? 'auto';
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const chain = (await this.registry.plan(this.engine)).filter((t) => !this.failed.has(t));
    let lastError: unknown = new LlmUnavailableError('No language model engine is available');
    for (const entry of chain) {
      const pseudo = this.sticky ? this.pseudo : new Pseudonymizer(this.locale);
      const port: LlmPort = entry.external ? new PseudonymizingLlmAdapter(entry.adapter, pseudo) : entry.adapter;
      try {
        const res = await port.complete(req);
        entry.breaker.recordSuccess();
        this.last = entry;
        const landedOnStub = entry.engine === 'STUB';
        const model = landedOnStub && this.firstFailure ? `${this.registry.tag(this.firstFailure)}${FALLBACK_TAG}` : res.model;
        return { ...res, model, engine: entry.engine, mode: entry.mode };
      } catch (error) {
        if (!(error instanceof LlmUnavailableError)) throw error;
        lastError = error;
        const breaker = entry.breaker;
        if (error instanceof LlmRateLimitedError) breaker.trip(Math.min(300, Math.max(30, error.retryAfterSeconds ?? 60)) * 1000);
        else if (error instanceof LlmAuthError) breaker.trip(300_000);
        else breaker.recordFailure();
        if (this.sticky) this.failed.add(entry);
        this.firstFailure ??= entry;
        this.registry.logger?.warn('llm engine failed; trying the next one', { engine: entry.engine, model: entry.model, reason: (error as Error).message.slice(0, 200) });
      }
    }
    throw lastError;
  }
}
