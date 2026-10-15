import { AsyncLocalStorage } from 'node:async_hooks';

import { MongoServerError, type ClientSession, type Collection, type Db, type Document, type MongoClient } from 'mongodb';

import type { UnitOfWork } from '../../../use-cases/ports';

/** Holds the connection and the ambient transaction (AsyncLocalStorage) so repositories join the same session. */
export class MongoContext {
  private readonly als = new AsyncLocalStorage<ClientSession>();

  constructor(
    readonly client: MongoClient,
    readonly db: Db,
  ) {}

  get session(): ClientSession | undefined {
    return this.als.getStore();
  }

  /** Options to spread into every driver call that must take part in the ambient transaction. */
  get opts(): { session?: ClientSession } {
    const session = this.session;
    return session ? { session } : {};
  }

  runWith<T>(session: ClientSession | undefined, work: () => Promise<T>): Promise<T> {
    return session ? this.als.run(session, work) : work();
  }

  col(name: string): Collection<Document> {
    return this.db.collection(name);
  }
}

export class MongoUnitOfWork implements UnitOfWork {
  constructor(private readonly ctx: MongoContext) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.ctx.session) return work();
    return this.ctx.client.withSession(async (session) => {
      let result: T | undefined;
      await session.withTransaction(
        async () => {
          result = await this.ctx.runWith(session, work);
        },
        { readConcern: { level: 'majority' }, writeConcern: { w: 'majority' } },
      );
      return result as T;
    });
  }
}

export const isDuplicateKey = (error: unknown, keyPart?: string): boolean =>
  error instanceof MongoServerError && error.code === 11000 && (!keyPart || JSON.stringify(error.keyPattern ?? {}).includes(keyPart) || String(error.message).includes(keyPart));

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keyset predicate for `ORDER BY createdAt DESC, _id DESC` (or ASC with `ascending`). */
export function keyset(cursor: { createdAt: Date; id: string } | null, field = 'createdAt', ascending = false): Document {
  if (!cursor) return {};
  const op = ascending ? '$gt' : '$lt';
  return { $or: [{ [field]: { [op]: cursor.createdAt } }, { [field]: cursor.createdAt, _id: { [op]: cursor.id } }] };
}
