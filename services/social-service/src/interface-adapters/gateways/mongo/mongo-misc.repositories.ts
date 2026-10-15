import type { Document } from 'mongodb';

import type { CommentProps, CommentStatus } from '../../../entities/comment.entity';
import type { ContentReportProps, ReportResolution, ReportStatus, ReportTargetType } from '../../../entities/content-report.entity';
import { DomainError } from '../../../entities/errors/domain-error';
import type { FollowProps } from '../../../entities/follow.entity';
import { Group, type MembershipProps, type MembershipStatus } from '../../../entities/group.entity';
import type { ReactionType } from '../../../entities/post.entity';
import { Profile } from '../../../entities/profile.entity';
import type { MediaAssetView } from '../../../entities/value-objects/media';
import type {
  CommentRepository,
  ContentStatsRepository,
  DailyContentStats,
  FollowRepository,
  GroupRepository,
  KeysetCursor,
  MediaAssetViewRepository,
  MembershipRepository,
  MembershipTransition,
  ProfileRepository,
  ReactionRepository,
  ReportRepository,
} from '../../../use-cases/ports';
import { escapeRegex, isDuplicateKey, keyset, type MongoContext } from './mongo-context';

// ---------------------------------------------------------------- profiles
const toProfile = (d: Document): Profile =>
  Profile.restore({
    userId: d._id,
    displayName: d.displayName,
    universityId: d.universityId ?? null,
    career: d.career ?? null,
    semester: d.semester ?? null,
    bio: d.bio ?? null,
    interests: d.interests ?? [],
    avatarMediaId: d.avatarMediaId ?? null,
    pendingAvatarMediaId: d.pendingAvatarMediaId ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  });

const profileDoc = (p: Profile): Document => {
  const { userId, ...rest } = p.snapshot;
  return { _id: userId, ...rest };
};

export class MongoProfileRepository implements ProfileRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('profiles');
  }

  async findById(userId: string): Promise<Profile | null> {
    const d = await this.col.findOne({ _id: userId as never }, this.ctx.opts);
    return d ? toProfile(d) : null;
  }

  async findByIds(userIds: readonly string[]): Promise<Profile[]> {
    if (userIds.length === 0) return [];
    return (await this.col.find({ _id: { $in: [...userIds] } as never }, this.ctx.opts).toArray()).map(toProfile);
  }

  async insertIfAbsent(profile: Profile): Promise<boolean> {
    const { _id, ...rest } = profileDoc(profile);
    const res = await this.col.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true, ...this.ctx.opts });
    return res.upsertedCount === 1;
  }

  async save(profile: Profile): Promise<void> {
    const { _id, ...rest } = profileDoc(profile);
    await this.col.updateOne({ _id }, { $set: rest }, this.ctx.opts);
  }

  async findByPendingAvatar(mediaId: string): Promise<Profile[]> {
    return (await this.col.find({ pendingAvatarMediaId: mediaId }, this.ctx.opts).limit(50).toArray()).map(toProfile);
  }
}

// ----------------------------------------------------------------- follows
export class MongoFollowRepository implements FollowRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('follows');
  }

  async insertIfAbsent(follow: FollowProps): Promise<{ follow: FollowProps; created: boolean }> {
    const res = await this.col.updateOne(
      { followerId: follow.followerId, followeeId: follow.followeeId },
      { $setOnInsert: { createdAt: follow.createdAt } },
      { upsert: true, ...this.ctx.opts },
    );
    if (res.upsertedCount === 1) return { follow, created: true };
    const d = await this.col.findOne({ followerId: follow.followerId, followeeId: follow.followeeId }, this.ctx.opts);
    return { follow: { followerId: follow.followerId, followeeId: follow.followeeId, createdAt: d?.createdAt ?? follow.createdAt }, created: false };
  }

  async delete(followerId: string, followeeId: string): Promise<void> {
    await this.col.deleteOne({ followerId, followeeId }, this.ctx.opts);
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    return (await this.col.countDocuments({ followerId, followeeId }, { limit: 1, ...this.ctx.opts })) > 0;
  }

  async findFolloweeIds(followerId: string, limit: number): Promise<string[]> {
    return (await this.col.find({ followerId }, { projection: { followeeId: 1 }, ...this.ctx.opts }).limit(limit).toArray()).map((d) => d.followeeId as string);
  }

  countFollowers(userId: string): Promise<number> {
    return this.col.countDocuments({ followeeId: userId }, this.ctx.opts);
  }

  countFollowing(userId: string): Promise<number> {
    return this.col.countDocuments({ followerId: userId }, this.ctx.opts);
  }
}

// ---------------------------------------------------------------- comments
const toComment = (d: Document): CommentProps => ({
  id: d._id,
  postId: d.postId,
  authorId: d.authorId,
  parentId: d.parentId ?? null,
  text: d.text,
  status: d.status,
  replyCount: d.replyCount ?? 0,
  openReportsCount: d.openReportsCount ?? 0,
  createdAt: d.createdAt,
});

export class MongoCommentRepository implements CommentRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('comments');
  }

  async insert(comment: CommentProps): Promise<void> {
    const { id, ...rest } = comment;
    await this.col.insertOne({ _id: id as never, ...rest }, this.ctx.opts);
  }

  async findById(id: string): Promise<CommentProps | null> {
    const d = await this.col.findOne({ _id: id as never }, this.ctx.opts);
    return d ? toComment(d) : null;
  }

  async list(postId: string, viewerId: string, cursor: KeysetCursor | null, limit: number): Promise<CommentProps[]> {
    const filter: Document = { postId, $and: [{ $or: [{ status: 'VISIBLE' }, { status: 'HIDDEN', authorId: viewerId }] }, keyset(cursor, 'createdAt', true)] };
    return (await this.col.find(filter, this.ctx.opts).sort({ createdAt: 1, _id: 1 }).limit(limit).toArray()).map(toComment);
  }

  async incrementReplyCount(parentId: string): Promise<void> {
    await this.col.updateOne({ _id: parentId as never }, { $inc: { replyCount: 1 } }, this.ctx.opts);
  }

  async incrementOpenReports(commentId: string): Promise<number | null> {
    const d = await this.col.findOneAndUpdate({ _id: commentId as never }, { $inc: { openReportsCount: 1 } }, { returnDocument: 'after', ...this.ctx.opts });
    return d ? (d.openReportsCount as number) : null;
  }

  async hideIfVisible(commentId: string, now: Date): Promise<boolean> {
    const res = await this.col.updateOne({ _id: commentId as never, status: 'VISIBLE' }, { $set: { status: 'HIDDEN', hiddenBy: 'REPORTED', updatedAt: now } }, this.ctx.opts);
    return res.modifiedCount === 1;
  }

  async setStatus(commentId: string, status: CommentStatus, now: Date): Promise<boolean> {
    const res = await this.col.updateOne({ _id: commentId as never, status: { $ne: status } }, { $set: { status, updatedAt: now }, $unset: { hiddenBy: '' } }, this.ctx.opts);
    return res.modifiedCount === 1;
  }

  async setOpenReports(commentId: string, count: number): Promise<void> {
    await this.col.updateOne({ _id: commentId as never }, { $set: { openReportsCount: count } }, this.ctx.opts);
  }

  async hideVisibleByAuthor(authorId: string): Promise<number> {
    const res = await this.col.updateMany({ authorId, status: 'VISIBLE' }, { $set: { status: 'HIDDEN', hiddenBy: 'AUTHOR_SUSPENDED' } }, this.ctx.opts);
    return res.modifiedCount;
  }

  async restoreHiddenByAuthor(authorId: string): Promise<number> {
    const res = await this.col.updateMany({ authorId, status: 'HIDDEN', hiddenBy: 'AUTHOR_SUSPENDED' }, { $set: { status: 'VISIBLE' }, $unset: { hiddenBy: '' } }, this.ctx.opts);
    return res.modifiedCount;
  }
}

// --------------------------------------------------------------- reactions
export class MongoReactionRepository implements ReactionRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('reactions');
  }

  async set(postId: string, userId: string, type: ReactionType, now: Date): Promise<{ previous: ReactionType | null }> {
    const before = await this.col.findOneAndUpdate(
      { postId, userId },
      { $set: { type, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'before', ...this.ctx.opts },
    );
    return { previous: (before?.type as ReactionType | undefined) ?? null };
  }

  async remove(postId: string, userId: string): Promise<ReactionType | null> {
    const d = await this.col.findOneAndDelete({ postId, userId }, this.ctx.opts);
    return (d?.type as ReactionType | undefined) ?? null;
  }

  async findMine(postIds: readonly string[], userId: string): Promise<Map<string, ReactionType>> {
    if (postIds.length === 0) return new Map();
    const docs = await this.col.find({ userId, postId: { $in: [...postIds] } }, this.ctx.opts).toArray();
    return new Map(docs.map((d) => [d.postId as string, d.type as ReactionType]));
  }
}

// ------------------------------------------------------------------ groups
const toGroup = (d: Document): Group =>
  Group.restore({ id: d._id, name: d.name, subject: d.subject, privacy: d.privacy, ownerId: d.ownerId, membersCount: d.membersCount ?? 0, createdAt: d.createdAt });

export class MongoGroupRepository implements GroupRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('groups');
  }

  async insert(group: Group): Promise<void> {
    const { id, ...rest } = group.snapshot;
    await this.col.insertOne({ _id: id as never, ...rest }, this.ctx.opts);
  }

  async findById(id: string): Promise<Group | null> {
    const d = await this.col.findOne({ _id: id as never }, this.ctx.opts);
    return d ? toGroup(d) : null;
  }

  async search(query: string | undefined, cursor: KeysetCursor | null, limit: number): Promise<Group[]> {
    const and: Document[] = [keyset(cursor)];
    if (query) {
      const re = new RegExp(escapeRegex(query.trim()), 'i');
      and.push({ $or: [{ name: re }, { subject: re }] });
    }
    return (await this.col.find({ $and: and }, this.ctx.opts).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray()).map(toGroup);
  }

  async listPublicByCareer(career: string, limit: number, offset: number): Promise<Group[]> {
    const rows = await this.ctx
      .col('groupMemberships')
      .aggregate(
        [
          { $match: { status: 'ACTIVE' } },
          { $lookup: { from: 'profiles', localField: 'userId', foreignField: '_id', as: 'p' } },
          { $match: { 'p.career': { $regex: `^${escapeRegex(career)}$`, $options: 'i' } } },
          { $group: { _id: '$groupId' } },
          { $lookup: { from: 'groups', localField: '_id', foreignField: '_id', as: 'g' } },
          { $unwind: '$g' },
          { $match: { 'g.privacy': 'PUBLIC' } },
          { $sort: { 'g.membersCount': -1, 'g._id': 1 } },
          { $skip: offset },
          { $limit: limit },
        ],
        this.ctx.opts,
      )
      .toArray();
    return rows.map((r) => toGroup(r.g as Document));
  }

  async incrementMembers(groupId: string, delta: number): Promise<void> {
    await this.col.updateOne({ _id: groupId as never }, { $inc: { membersCount: delta } }, this.ctx.opts);
  }
}

const toMembership = (d: Document): MembershipProps => ({
  groupId: d.groupId,
  userId: d.userId,
  role: d.role,
  status: d.status,
  requestedAt: d.requestedAt,
  updatedAt: d.updatedAt,
});

export class MongoMembershipRepository implements MembershipRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('groupMemberships');
  }

  async find(groupId: string, userId: string): Promise<MembershipProps | null> {
    const d = await this.col.findOne({ groupId, userId }, this.ctx.opts);
    return d ? toMembership(d) : null;
  }

  async findForGroups(userId: string, groupIds: readonly string[]): Promise<Map<string, MembershipProps>> {
    if (groupIds.length === 0) return new Map();
    const docs = await this.col.find({ userId, groupId: { $in: [...groupIds] } }, this.ctx.opts).toArray();
    return new Map(docs.map((d) => [d.groupId as string, toMembership(d)]));
  }

  async insert(m: MembershipProps): Promise<boolean> {
    const { groupId, userId, ...rest } = m;
    const res = await this.col.updateOne({ groupId, userId }, { $setOnInsert: rest }, { upsert: true, ...this.ctx.opts });
    return res.upsertedCount === 1;
  }

  async transition(groupId: string, userId: string, change: MembershipTransition, now: Date): Promise<MembershipProps | null> {
    const set: Document = { status: change.to, updatedAt: now };
    if (change.role) set.role = change.role;
    if (change.to === 'PENDING' || (change.from.some((s) => s === 'REJECTED' || s === 'LEFT') && change.to === 'ACTIVE')) set.requestedAt = now;
    const d = await this.col.findOneAndUpdate({ groupId, userId, status: { $in: [...change.from] } }, { $set: set }, { returnDocument: 'after', ...this.ctx.opts });
    return d ? toMembership(d) : null;
  }

  async list(groupId: string, status: MembershipStatus, cursor: KeysetCursor | null, limit: number): Promise<MembershipProps[]> {
    const filter: Document = { groupId, status, ...(cursor ? { $or: [{ requestedAt: { $lt: cursor.createdAt } }, { requestedAt: cursor.createdAt, userId: { $lt: cursor.id } }] } : {}) };
    return (await this.col.find(filter, this.ctx.opts).sort({ requestedAt: -1, userId: -1 }).limit(limit).toArray()).map(toMembership);
  }

  async listActiveGroupIds(userId: string, limit: number): Promise<string[]> {
    return (await this.col.find({ userId, status: 'ACTIVE' }, { projection: { groupId: 1 }, ...this.ctx.opts }).limit(limit).toArray()).map((d) => d.groupId as string);
  }

  async listManagerIds(groupId: string): Promise<string[]> {
    return (await this.col.find({ groupId, status: 'ACTIVE', role: { $in: ['OWNER', 'ADMIN'] } }, { projection: { userId: 1 }, ...this.ctx.opts }).toArray()).map((d) => d.userId as string);
  }
}

// ----------------------------------------------------------------- reports
const toReport = (d: Document): ContentReportProps => ({
  id: d._id,
  targetType: d.targetType,
  targetId: d.targetId,
  targetAuthorId: d.targetAuthorId,
  reporterId: d.reporterId,
  reason: d.reason,
  details: d.details ?? null,
  status: d.status,
  resolution: d.resolution ?? null,
  resolutionNote: d.resolutionNote ?? null,
  resolvedBy: d.resolvedBy ?? null,
  createdAt: d.createdAt,
  resolvedAt: d.resolvedAt ?? null,
});

export class MongoReportRepository implements ReportRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('contentReports');
  }

  async insert(report: ContentReportProps): Promise<void> {
    const { id, ...rest } = report;
    try {
      await this.col.insertOne({ _id: id as never, ...rest }, this.ctx.opts);
    } catch (error) {
      if (isDuplicateKey(error, 'reporterId')) throw new DomainError('ALREADY_REPORTED');
      throw error;
    }
  }

  async findById(id: string): Promise<ContentReportProps | null> {
    const d = await this.col.findOne({ _id: id as never }, this.ctx.opts);
    return d ? toReport(d) : null;
  }

  async listByStatus(status: ReportStatus, cursor: KeysetCursor | null, limit: number): Promise<ContentReportProps[]> {
    const filter: Document = { status, ...keyset(cursor, 'createdAt', true) };
    return (await this.col.find(filter, this.ctx.opts).sort({ createdAt: 1, _id: 1 }).limit(limit).toArray()).map(toReport);
  }

  async resolveOpenForTarget(
    type: ReportTargetType,
    targetId: string,
    change: { resolution: ReportResolution; note: string | null; actorId: string },
    now: Date,
  ): Promise<ContentReportProps[]> {
    const open = await this.col.find({ targetType: type, targetId, status: 'OPEN' }, this.ctx.opts).toArray();
    if (open.length === 0) return [];
    const status: ReportStatus = change.resolution === 'REMOVE' ? 'RESOLVED_REMOVED' : 'RESOLVED_KEPT';
    await this.col.updateMany(
      { _id: { $in: open.map((d) => d._id) }, status: 'OPEN' },
      { $set: { status, resolution: change.resolution, resolutionNote: change.note, resolvedBy: change.actorId, resolvedAt: now } },
      this.ctx.opts,
    );
    return open.map((d) => ({ ...toReport(d), status, resolution: change.resolution, resolutionNote: change.note, resolvedBy: change.actorId, resolvedAt: now }));
  }
}

// ------------------------------------------------------------- media views
export class MongoMediaAssetViewRepository implements MediaAssetViewRepository {
  constructor(private readonly ctx: MongoContext) {}
  private get col() {
    return this.ctx.col('mediaAssetViews');
  }

  async findMany(ids: readonly string[]): Promise<Map<string, MediaAssetView>> {
    if (ids.length === 0) return new Map();
    const docs = await this.col.find({ _id: { $in: [...ids] } as never }, this.ctx.opts).toArray();
    return new Map(docs.map((d) => [d._id as unknown as string, { mediaId: d._id as unknown as string, ownerId: d.ownerId, kind: d.kind, status: d.status, updatedAt: d.updatedAt }]));
  }

  async upsert(view: MediaAssetView): Promise<void> {
    await this.col.updateOne({ _id: view.mediaId as never }, { $set: { ownerId: view.ownerId, kind: view.kind, status: view.status, updatedAt: view.updatedAt } }, { upsert: true, ...this.ctx.opts });
  }

  async upsertIfNotFinal(view: MediaAssetView): Promise<void> {
    try {
      await this.col.updateOne(
        { _id: view.mediaId as never, status: { $nin: ['APPROVED', 'FLAGGED', 'REJECTED'] } },
        { $set: { ownerId: view.ownerId, kind: view.kind, status: view.status, updatedAt: view.updatedAt } },
        { upsert: true, ...this.ctx.opts },
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // a final status already stored by an event wins
    }
  }
}

// ------------------------------------------------------------------- stats
export class MongoContentStatsRepository implements ContentStatsRepository {
  constructor(private readonly ctx: MongoContext) {}

  async daily(from: Date, toExclusive: Date): Promise<DailyContentStats[]> {
    const day = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } });
    const range = (field: string) => ({ [field]: { $gte: from, $lt: toExclusive } });
    const count = async (collection: string, field: string, extra: Document = {}): Promise<Map<string, number>> => {
      const rows = await this.ctx.col(collection).aggregate([{ $match: { ...range(field), ...extra } }, { $group: { _id: day(field), n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [r._id as string, r.n as number]));
    };
    const [posts, comments, reactions, follows, hidden, authors] = await Promise.all([
      count('posts', 'createdAt'),
      count('comments', 'createdAt'),
      count('reactions', 'createdAt'),
      count('follows', 'createdAt'),
      count('posts', 'hiddenAt'),
      this.ctx
        .col('posts')
        .aggregate([{ $match: range('createdAt') }, { $group: { _id: { d: day('createdAt'), a: '$authorId' } } }, { $group: { _id: '$_id.d', n: { $sum: 1 } } }])
        .toArray(),
    ]);
    const activeAuthors = new Map(authors.map((r) => [r._id as string, r.n as number]));
    const dates = new Set([...posts.keys(), ...comments.keys(), ...reactions.keys(), ...follows.keys(), ...hidden.keys()]);
    return [...dates].sort().map((date) => ({
      date,
      postsCreated: posts.get(date) ?? 0,
      commentsCreated: comments.get(date) ?? 0,
      reactionsSet: reactions.get(date) ?? 0,
      followsCreated: follows.get(date) ?? 0,
      activeAuthors: activeAuthors.get(date) ?? 0,
      postsHidden: hidden.get(date) ?? 0,
    }));
  }

  async topHashtags(from: Date, toExclusive: Date, limit: number): Promise<Array<{ hashtag: string; count: number }>> {
    const rows = await this.ctx
      .col('posts')
      .aggregate([
        { $match: { createdAt: { $gte: from, $lt: toExclusive }, status: { $in: ['PUBLISHED', 'HIDDEN'] } } },
        { $unwind: '$hashtags' },
        { $group: { _id: '$hashtags', n: { $sum: 1 } } },
        { $sort: { n: -1, _id: 1 } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((r) => ({ hashtag: r._id as string, count: r.n as number }));
  }
}
