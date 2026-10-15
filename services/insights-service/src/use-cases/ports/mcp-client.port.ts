import type { LlmToolDef } from './llm.port';

export interface McpToolResult {
  /** Serialized JSON text (what the LLM sees). */
  content: string;
  isError: boolean;
  structured?: unknown;
}
export interface McpClientPort {
  listTools(): Promise<LlmToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}
/** One client per agent run: carries the actor and correlation id as headers (audit trail). */
export interface McpClientFactory {
  create(ctx: { actorId?: string; correlationId?: string; agentRunId?: string }): Promise<McpClientPort>;
}
export const MCP_CLIENT_FACTORY = Symbol('McpClientFactory');
