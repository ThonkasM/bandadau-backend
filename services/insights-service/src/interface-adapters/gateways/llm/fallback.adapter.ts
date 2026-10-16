import { LlmUnavailableError } from '../../../entities/errors/domain-errors';
import type { LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';

/** `LLM_FALLBACK=stub` for a real provider: when it is unavailable (network, quota, timeout) the deterministic generator answers instead. */
export class FallbackLlmAdapter implements LlmPort {
  constructor(
    private readonly primary: LlmPort,
    private readonly fallback: LlmPort,
  ) {}

  get provider(): string {
    return this.primary.provider;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.primary.complete(req);
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      const res = await this.fallback.complete(req);
      return { ...res, model: `${res.model}(fallback)` };
    }
  }
}
