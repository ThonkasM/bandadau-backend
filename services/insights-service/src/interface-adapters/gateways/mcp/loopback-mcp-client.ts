import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { LlmToolDef } from '../../../use-cases/ports/llm.port';
import type { McpClientFactory, McpClientPort, McpToolResult } from '../../../use-cases/ports/mcp-client.port';
import type { AuthHeaders } from '../internal-api/http-json';

class SdkMcpClient implements McpClientPort {
  private cached: LlmToolDef[] | null = null;
  constructor(private readonly client: Client) {}

  async listTools(): Promise<LlmToolDef[]> {
    if (!this.cached) {
      const res = await this.client.listTools();
      this.cached = res.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> }));
    }
    return this.cached;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const res = await this.client.callTool({ name, arguments: args });
    const blocks = (res.content ?? []) as { type: string; text?: string }[];
    const content = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
    return { content, isError: res.isError === true, structured: res.structuredContent };
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

/**
 * Agents are MCP clients of this very server (D8, mcp.md 6): HTTP loopback to `MCP_INTERNAL_URL` with the service token, so
 * authentication, validation, rate limits and audit are the same as for an external client.
 */
export class LoopbackMcpClientFactory implements McpClientFactory {
  constructor(
    private readonly url: string,
    private readonly tokens: AuthHeaders,
  ) {}

  async create(ctx: { actorId?: string; correlationId?: string; agentRunId?: string }): Promise<McpClientPort> {
    const tokens = this.tokens;
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      // fresh service token on every request (it lives 5 minutes)
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        for (const [k, v] of Object.entries(await tokens.authHeaders({ actorId: ctx.actorId, correlationId: ctx.correlationId }))) headers.set(k, v);
        if (ctx.agentRunId) headers.set('X-Agent-Run-Id', ctx.agentRunId);
        return fetch(input, { ...init, headers });
      },
    });
    const client = new Client({ name: 'bandada-insights-agent', version: '1.0.0' });
    await client.connect(transport);
    return new SdkMcpClient(client);
  }
}
