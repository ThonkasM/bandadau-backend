import { EventEmitter } from 'node:events';

import amqplib from 'amqplib';

export interface BusEvent {
  type: string;
  id: string;
  time?: string;
  data: Record<string, unknown>;
}

export interface BusOptions {
  url: string;
  instanceId: string;
  exchange?: string;
  bindings: string[];
  log?: { info(m: string): void; warn(m: string): void; error(m: string): void };
  reconnectMs?: number;
}

/**
 * Feeds GraphQL subscriptions. Declares one exclusive, auto-delete queue per gateway instance
 * (`admin-gateway.subscriptions.<instanceId>`) bound to the events exchange; reconnects on failure.
 */
export class RabbitEventBus {
  private readonly emitter = new EventEmitter();
  private conn?: Awaited<ReturnType<typeof amqplib.connect>>;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private connected = false;

  constructor(private readonly options: BusOptions) {
    this.emitter.setMaxListeners(0);
  }

  get queueName(): string {
    return `admin-gateway.subscriptions.${this.options.instanceId}`;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Never rejects: the gateway starts even if the broker is down and keeps retrying in the background. */
  start(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const { log, reconnectMs = 5000 } = this.options;
    try {
      const conn = await amqplib.connect(this.options.url);
      const ch = await conn.createChannel();
      conn.on('error', () => undefined);
      conn.on('close', () => {
        this.connected = false;
        if (!this.stopped) {
          log?.warn('rabbitmq connection closed; retrying');
          this.schedule(reconnectMs);
        }
      });
      await ch.assertQueue(this.queueName, { exclusive: true, autoDelete: true, durable: false });
      const exchange = this.options.exchange ?? 'bandada.events';
      for (const key of this.options.bindings) await ch.bindQueue(this.queueName, exchange, key);
      await ch.consume(this.queueName, (msg) => {
        if (!msg) return;
        try {
          const event = JSON.parse(msg.content.toString('utf8')) as BusEvent;
          if (event && typeof event.type === 'string') this.emitter.emit('event', event);
        } catch {
          log?.warn('discarding malformed event');
        }
        ch.ack(msg);
      });
      this.conn = conn;
      this.connected = true;
      log?.info(`subscription queue ${this.queueName} ready`);
    } catch (error) {
      this.connected = false;
      log?.warn(`rabbitmq unavailable (${(error as Error).message}); retrying in ${reconnectMs}ms`);
      this.schedule(reconnectMs);
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.connect(), ms);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.emitter.emit('stop');
    await this.conn?.close().catch(() => undefined);
  }

  /** Async iterator of the events whose `type` is in `types`; ends when the consumer stops or the bus closes. */
  async *iterate(types: readonly string[], signal?: AbortSignal): AsyncGenerator<BusEvent> {
    const wanted = (t: string) => types.some((x) => (x.endsWith('.#') ? t.startsWith(x.slice(0, -1)) : x === t));
    const buffer: BusEvent[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    const onEvent = (e: BusEvent) => {
      if (!wanted(e.type)) return;
      buffer.push(e);
      wake?.();
    };
    const onStop = () => {
      done = true;
      wake?.();
    };
    this.emitter.on('event', onEvent);
    this.emitter.on('stop', onStop);
    signal?.addEventListener('abort', onStop);
    try {
      while (!done) {
        const next = buffer.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } finally {
      this.emitter.off('event', onEvent);
      this.emitter.off('stop', onStop);
    }
  }

  /** Test helper: inject an event as if it came from the broker. */
  inject(event: BusEvent): void {
    this.emitter.emit('event', event);
  }
}
