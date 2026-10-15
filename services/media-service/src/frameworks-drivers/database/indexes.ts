import type { Db } from 'mongodb';

/** Idempotent index creation, run on every start. */
export async function ensureIndexes(db: Db): Promise<void> {
  const media = db.collection('mediaAssets');
  await Promise.all([
    media.createIndex({ status: 1, createdAt: 1, _id: 1 }, { name: 'status_created' }),
    media.createIndex({ status: 1, updatedAt: 1 }, { name: 'status_updated' }),
    media.createIndex({ ownerId: 1, status: 1 }, { name: 'owner_status' }),
  ]);
}
