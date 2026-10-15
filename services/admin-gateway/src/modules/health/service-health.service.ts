import type { GatewayConfig } from '../../config/env';

type Status = 'UP' | 'DEGRADED' | 'DOWN';

export interface ServiceHealthModel {
  name: string;
  status: Status;
  latencyMs: number | null;
  checks: Record<string, unknown> | null;
  error: string | null;
}

export class ServiceHealthService {
  constructor(
    private readonly config: GatewayConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async probe(name: string, baseUrl: string): Promise<ServiceHealthModel> {
    const started = Date.now();
    try {
      const res = await this.fetchImpl(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(this.config.httpTimeoutMs) });
      const latencyMs = Date.now() - started;
      const body = (await res.json().catch(() => null)) as { status?: string; checks?: Record<string, unknown> } | null;
      const declared = body?.status && ['UP', 'DEGRADED', 'DOWN'].includes(body.status) ? (body.status as Status) : undefined;
      return {
        name,
        status: res.ok ? (declared ?? 'UP') : declared === 'DEGRADED' ? 'DEGRADED' : 'DOWN',
        latencyMs,
        checks: body?.checks ?? null,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (cause) {
      return { name, status: 'DOWN', latencyMs: null, checks: null, error: (cause as Error).message };
    }
  }

  private async queues() {
    const base = this.config.rabbitmqManagementUrl;
    if (!base) return [];
    try {
      const auth = Buffer.from(`${this.config.rabbitmqManagementUser}:${this.config.rabbitmqManagementPassword}`).toString('base64');
      const res = await this.fetchImpl(`${base}/api/queues/%2F?columns=name,messages_ready,messages_unacknowledged,consumers`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as { name: string; messages_ready?: number; messages_unacknowledged?: number; consumers?: number }[];
      return list
        .filter((q) => !q.name.startsWith('admin-gateway.subscriptions.'))
        .map((q) => ({
          name: q.name,
          messagesReady: q.messages_ready ?? 0,
          messagesUnacked: q.messages_unacknowledged ?? 0,
          consumers: q.consumers ?? 0,
          isDeadLetter: q.name.endsWith('.dlq'),
        }));
    } catch {
      return [];
    }
  }

  async report() {
    const s = this.config.services;
    const [services, queues] = await Promise.all([
      Promise.all([
        this.probe('identity-service', s.identity),
        this.probe('social-service', s.social),
        this.probe('media-service', s.media),
        this.probe('events-service', s.events),
        this.probe('wallet-service', s.wallet),
        this.probe('ticketing-service', s.ticketing),
        this.probe('notification-service', s.notification),
      ]),
      this.queues(),
    ]);
    const up = services.filter((x) => x.status === 'UP').length;
    const overall: Status = up === services.length ? 'UP' : up === 0 ? 'DOWN' : 'DEGRADED';
    return { checkedAt: new Date().toISOString(), overall, services, queues };
  }
}
