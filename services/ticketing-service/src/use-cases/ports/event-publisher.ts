import type { TransactionContext } from './transaction';

/** Trace data of the command that caused a message; carried over to the response. */
export interface MessageTrace {
  causationId?: string;
  correlationId?: string;
  sagaId?: string;
  traceparent?: string;
}

export interface OutboundMessage {
  type: string;
  /** e.g. `registrations/<id>`, `tickets/<id>`. */
  subject: string;
  data: Record<string, unknown>;
  trace: MessageTrace;
}

/** Records messages through the transactional outbox (never publishes inline). */
export interface EventPublisher {
  publish(messages: OutboundMessage[], tx?: TransactionContext): Promise<void>;
}
export const EVENT_PUBLISHER = Symbol('EventPublisher');
