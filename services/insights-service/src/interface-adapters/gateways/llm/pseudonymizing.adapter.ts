import { type Pseudonymizer } from '../../../entities/policies/pseudonymizer';
import type { LlmBlock, LlmMessage, LlmPort, LlmRequest, LlmResponse } from '../../../use-cases/ports/llm.port';

/**
 * Privacy towards an EXTERNAL provider (ADR-0022): learns the people names in the tool results, sends «Persona A/B…» instead,
 * masks emails, phones and tokens, and restores the real names in the answer. The caller's messages are never mutated and the
 * name map lives only as long as this instance (one per request).
 */
export class PseudonymizingLlmAdapter implements LlmPort {
  constructor(
    private readonly inner: LlmPort,
    private readonly pseudo: Pseudonymizer,
  ) {}

  get provider(): string {
    return this.inner.provider;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    for (const m of req.messages) for (const b of m.content) if (b.type === 'tool_result') this.pseudo.learn(b.content);
    const res = await this.inner.complete(this.outbound(req));
    return { ...res, content: res.content.map((b) => this.inbound(b)) };
  }

  private outbound(req: LlmRequest): LlmRequest {
    const s = (t: string) => this.pseudo.sanitize(t);
    const messages: LlmMessage[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content.map((b): LlmBlock => {
        if (b.type === 'text') return { type: 'text', text: s(b.text) };
        if (b.type === 'tool_result') return { ...b, content: s(b.content) };
        return { ...b, input: JSON.parse(s(JSON.stringify(b.input))) as Record<string, unknown> };
      }),
    }));
    return { ...req, system: s(req.system), messages, ...(req.meta ? { meta: { ...req.meta, ...(req.meta.question ? { question: s(req.meta.question) } : {}) } } : {}) };
  }

  private inbound(b: LlmBlock): LlmBlock {
    if (b.type === 'text') return { type: 'text', text: this.pseudo.restore(b.text) };
    if (b.type === 'tool_use') return { ...b, input: this.pseudo.restoreValue(b.input) as Record<string, unknown> };
    return b;
  }
}
