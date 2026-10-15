import { AuthError, authErrorToProblem } from '@bandada/auth-ts';
import { Public } from '@bandada/auth-ts/nest';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { All, Controller, Inject, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { McpAuthenticator } from '../../gateways/security/mcp-auth';
import { McpServerFactory } from './mcp-server.factory';

export const MCP_ALLOWED_ORIGINS = Symbol('MCP_ALLOWED_ORIGINS');

const problem = (status: number, code: string, title: string, detail: string, instance: string) => ({
  type: `https://api.bandadau.com/problems/${code.toLowerCase().replace(/_/g, '-')}`,
  title,
  status,
  code,
  detail,
  instance,
});

/** `/mcp`: Streamable HTTP, stateless (one McpServer + transport per request), JSON responses. */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger('Mcp');

  constructor(
    @Inject(McpAuthenticator) private readonly auth: McpAuthenticator,
    @Inject(McpServerFactory) private readonly factory: McpServerFactory,
    @Inject(MCP_ALLOWED_ORIGINS) private readonly allowedOrigins: string[],
  ) {}

  @Public()
  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const instance = '/mcp';
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins.includes(origin)) {
      res.status(403).type('application/problem+json').json(problem(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed', 'The Origin header is not in MCP_ALLOWED_ORIGINS.', instance));
      return;
    }
    let principal;
    try {
      principal = await this.auth.authenticate(req.headers.authorization);
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="bandada-mcp"');
        res.status(error.status).type('application/problem+json').json({ ...authErrorToProblem(error, instance) });
        return;
      }
      throw error;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).type('application/problem+json').json(problem(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', 'This MCP server is stateless: use POST /mcp.', instance));
      return;
    }
    const header = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const server = this.factory.create({
      principal,
      correlationId: header('x-correlation-id') ?? header('traceparent')?.split('-')[1],
      agentRunId: header('x-agent-run-id'),
      actorId: principal.typ === 'service' ? header('x-actor-id') : undefined,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`mcp request failed: ${(error as Error).message}`);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}
