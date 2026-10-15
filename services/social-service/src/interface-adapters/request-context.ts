import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
  /** W3C trace id (32 hex). */
  traceId: string;
  traceparent: string;
  locale: 'es' | 'en';
  /** Id of the message being processed (consumers), propagated as `causationid`. */
  causationId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** Builds a context from incoming `traceparent`/correlation values (generating what is missing). */
export function newRequestContext(input: { correlationId?: string; traceparent?: string; locale?: 'es' | 'en'; causationId?: string; fallbackCorrelationId: string }): RequestContext {
  const match = input.traceparent ? TRACEPARENT.exec(input.traceparent) : null;
  const traceId = match?.[1] ?? randomBytes(16).toString('hex');
  const traceparent = match ? (input.traceparent as string) : `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
  return {
    correlationId: input.correlationId || input.fallbackCorrelationId,
    traceId,
    traceparent,
    locale: input.locale ?? 'es',
    ...(input.causationId ? { causationId: input.causationId } : {}),
  };
}
