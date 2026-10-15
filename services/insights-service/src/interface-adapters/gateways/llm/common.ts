import { LlmUnavailableError } from '../../../entities/errors/domain-errors';
import type { LlmBlock, LlmMessage } from '../../../use-cases/ports/llm.port';

/** Turns tool blocks into plain text, for calls that carry no `tools` (final composition, audio script). */
export function flattenToolBlocks(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): LlmBlock => {
      if (b.type === 'tool_use') return { type: 'text', text: `[tool call: ${b.name} ${JSON.stringify(b.input)}]` };
      if (b.type === 'tool_result') return { type: 'text', text: b.content };
      return b;
    }),
  }));
}

/** Merges consecutive messages of the same role (some providers require strict alternation). */
export function mergeSameRole(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = [...last.content, ...m.content];
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

export const textOf = (blocks: LlmBlock[]): string => blocks.filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');

export function asUnavailable(error: unknown): never {
  const e = error as { status?: number; name?: string; message?: string };
  throw new LlmUnavailableError(`${e.name ?? 'Error'}${e.status ? ` ${e.status}` : ''}: ${(e.message ?? '').slice(0, 160)}`);
}
