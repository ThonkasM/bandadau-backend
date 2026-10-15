import type { Document } from 'mongodb';

import { DomainError } from '../../../entities/errors/domain-error';
import { Post, reactionKey, type HiddenReason, type PostStatus, type ReactionType } from '../../../entities/post.entity';
import type { FeedQuery, KeysetCursor, PostRepository } from '../../../use-cases/ports';
import { isDuplicateKey, keyset, type MongoContext } from './mongo-context';

const toPost = (d: Document): Post =>
  Post.restore({
    id: d._id,
    clientId: d.clientId,
    authorId: d.authorId,
    authorUniversityId: d.authorUniversityId ?? null,
    authorCareer: d.authorCareer ?? null,
    text: d.text,
    hashtags: d.hashtags ?? [],
    visibility: d.visibility,
    groupId: d.groupId ?? null,
    status: d.status,
    hiddenReason: d.hiddenReason ?? null,
    hiddenAt: d.hiddenAt ?? null,
    mediaIds: d.mediaIds ?? [],
    reactionCounts: { like: d.reactionCounts?.like ?? 0, helpful: d.reactionCounts?.helpful ?? 0, funny: d.reactionCounts?.funny ?? 0, support: d.reactionCounts?.support ?? 0 },
    commentsCount: d.commentsCount ?? 0,
    openReportsCount: d.openReportsCount ?? 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  });

const SORT_DESC = { createdAt: -1, _id: -1 } as const;

export class MongoPostRepository implements PostRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get posts() {
    return this.ctx.col('posts');
  }

  async findById(id: string): Promise<Post | null> {
    const d = await this.posts.findOne({ _id: id as never }, this.ctx.opts);
    return d ? toPost(d) : null;
  }

  async findByIds(ids: readonly string[]): Promise<Post[]> {
    if (ids.length === 0) return [];
    return (await this.posts.find({ _id: { $in: [...ids] } as never }, this.ctx.opts).toArray()).map(toPost);
  }

  async findByAuthorAndClientId(authorId: string, clientId: string): Promise<Post | null> {
    const d = await this.posts.findOne({ authorId, clientId }, this.ctx.opts);
    return d ? toPost(d) : null;
  }

  async insert(post: Post): Promise<void> {
    const { id, ...rest } = post.snapshot;
    try {
      await this.posts.insertOne({ _id: id as never, ...rest }, this.ctx.opts);
    } catch (error) {
      if (isDuplicateKey(error, 'clientId')) throw new DomainError('DUPLICATE_CLIENT_ID');
      throw error;
    }
  }

  async saveStatus(post: Post, expected: readonly PostStatus[]): Promise<boolean> {
    const p = post.snapshot;
    const res = await this.posts.updateOne(
      { _id: p.id as never, status: { $in: [...expected] } },
      { $set: { status: p.status, hiddenReason: p.hiddenReason, hiddenAt: p.hiddenAt, updatedAt: p.updatedAt } },
      this.ctx.opts,
    );
    return res.modifiedCount === 1;
  }

  async findByMediaId(mediaId: string): Promise<Post[]> {
    return (await this.posts.find({ mediaIds: mediaId, status: { $in: ['PENDING_MEDIA', 'HIDDEN'] } }, this.ctx.opts).limit(200).toArray()).map(toPost);
  }

  async findPendingMedia(olderThan: Date, limit: number): Promise<Post[]> {
    return (await this.posts.find({ status: 'PENDING_MEDIA', createdAt: { $lt: olderThan } }, this.ctx.opts).sort({ createdAt: 1 }).limit(limit).toArray()).map(toPost);
  }

  async listByStatus(status: PostStatus, cursor: KeysetCursor | null, limit: number): Promise<Post[]> {
    return (await this.posts.find({ status, ...keyset(cursor) }, this.ctx.opts).sort(SORT_DESC).limit(limit).toArray()).map(toPost);
  }

  async listGroupPosts(groupId: string, cursor: KeysetCursor | null, limit: number): Promise<Post[]> {
    return (await this.posts.find({ groupId, status: 'PUBLISHED', visibility: 'GROUP', ...keyset(cursor) }, this.ctx.opts).sort(SORT_DESC).limit(limit).toArray()).map(toPost);
  }

  async findFeedPage(q: FeedQuery): Promise<Post[]> {
    const or: Document[] = [{ authorId: q.userId }];
    if (q.followingIds.length > 0) or.push({ authorId: { $in: [...q.followingIds] }, visibility: { $in: ['PUBLIC', 'FOLLOWERS'] } });
    if (q.groupIds.length > 0) or.push({ groupId: { $in: [...q.groupIds] }, visibility: 'GROUP' });
    if (q.career) {
      or.push({ visibility: 'PUBLIC', authorCareer: q.career, ...(q.universityId ? { authorUniversityId: q.universityId } : {}), createdAt: { $gte: q.popularSince } });
    }
    const filter: Document = { status: 'PUBLISHED', $and: [{ $or: or }, keyset(q.cursor)] };
    return (await this.posts.find(filter, this.ctx.opts).sort(SORT_DESC).limit(q.limit).toArray()).map(toPost);
  }

  countPublishedByAuthor(authorId: string): Promise<number> {
    return this.posts.countDocuments({ authorId, status: 'PUBLISHED' }, this.ctx.opts);
  }

  async incrementComments(postId: string, delta: number): Promise<void> {
    await this.posts.updateOne({ _id: postId as never }, { $inc: { commentsCount: delta } }, this.ctx.opts);
  }

  async adjustReactionCounts(postId: string, change: { add?: ReactionType; remove?: ReactionType }): Promise<void> {
    const inc: Record<string, number> = {};
    if (change.add) inc[`reactionCounts.${reactionKey(change.add)}`] = (inc[`reactionCounts.${reactionKey(change.add)}`] ?? 0) + 1;
    if (change.remove) inc[`reactionCounts.${reactionKey(change.remove)}`] = (inc[`reactionCounts.${reactionKey(change.remove)}`] ?? 0) - 1;
    if (Object.keys(inc).length > 0) await this.posts.updateOne({ _id: postId as never }, { $inc: inc }, this.ctx.opts);
  }

  async incrementOpenReports(postId: string): Promise<number | null> {
    const d = await this.posts.findOneAndUpdate({ _id: postId as never }, { $inc: { openReportsCount: 1 } }, { returnDocument: 'after', ...this.ctx.opts });
    return d ? (d.openReportsCount as number) : null;
  }

  async hideIfPublished(postId: string, reason: HiddenReason, now: Date): Promise<boolean> {
    const res = await this.posts.updateOne(
      { _id: postId as never, status: 'PUBLISHED' },
      { $set: { status: 'HIDDEN', hiddenReason: reason, hiddenAt: now, updatedAt: now } },
      this.ctx.opts,
    );
    return res.modifiedCount === 1;
  }

  async setOpenReports(postId: string, count: number): Promise<void> {
    await this.posts.updateOne({ _id: postId as never }, { $set: { openReportsCount: count } }, this.ctx.opts);
  }

  async hidePublishedByAuthor(authorId: string, reason: HiddenReason, now: Date): Promise<Array<{ id: string; authorId: string }>> {
    const ids = (await this.posts.find({ authorId, status: 'PUBLISHED' }, { projection: { _id: 1 }, ...this.ctx.opts }).limit(1000).toArray()).map((d) => d._id as unknown as string);
    if (ids.length === 0) return [];
    await this.posts.updateMany(
      { _id: { $in: ids } as never, status: 'PUBLISHED' },
      { $set: { status: 'HIDDEN', hiddenReason: reason, hiddenAt: now, updatedAt: now } },
      this.ctx.opts,
    );
    return ids.map((id) => ({ id, authorId }));
  }

  async restoreHiddenByAuthor(authorId: string, reason: HiddenReason, now: Date): Promise<number> {
    const res = await this.posts.updateMany(
      { authorId, status: 'HIDDEN', hiddenReason: reason },
      { $set: { status: 'PUBLISHED', hiddenReason: null, hiddenAt: null, updatedAt: now } },
      this.ctx.opts,
    );
    return res.modifiedCount;
  }
}
