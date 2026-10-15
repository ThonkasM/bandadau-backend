import type { components } from '@bandada/contracts-ts/openapi/social';

import type { CommentOutput } from '../../use-cases/comments/create-comment.use-case';
import type { FeedItemOutput } from '../../use-cases/feed/get-feed.use-case';
import type { FollowProps } from '../../entities/follow.entity';
import type { ContentReportProps } from '../../entities/content-report.entity';
import type { MembershipProps } from '../../entities/group.entity';
import type { GroupOutput, MembershipOutput } from '../../use-cases/groups/group.use-cases';
import type { AuthorSummary, PostOutput } from '../../use-cases/outputs';
import type { ProfileOutput } from '../../use-cases/profiles/profile.use-cases';
import type { ReactionStateOutput } from '../../use-cases/reactions/set-reaction.use-case';
import type { ModerationPostOutput } from '../../use-cases/reports/moderation.use-cases';
import type { ContentDailyStatsOutput } from '../../use-cases/reports/daily-stats.use-case';
import type { Page } from '../../use-cases/ports';
import { encodeCursor } from './cursor';

type S = components['schemas'];

const iso = (d: Date): string => d.toISOString();

export const page = <T, R>(p: Page<T>, map: (item: T) => R): { items: R[]; nextCursor: string | null } => ({
  items: p.items.map(map),
  nextCursor: encodeCursor(p.nextCursor),
});

export const presentAuthor = (a: AuthorSummary): S['ProfileSummary'] => ({ userId: a.userId, displayName: a.displayName, avatarUrl: a.avatarUrl });

export function presentPost(o: PostOutput): S['Post'] {
  const p = o.post;
  return {
    id: p.id,
    clientId: p.clientId,
    authorId: p.authorId,
    author: presentAuthor(o.author),
    text: p.text,
    hashtags: [...p.hashtags],
    visibility: p.visibility,
    groupId: p.groupId,
    status: p.status,
    media: o.media.map((m) => ({ mediaId: m.mediaId, kind: m.kind, status: m.status, url: m.url, thumbnailUrl: m.thumbnailUrl })),
    reactionCounts: { ...p.reactionCounts },
    commentsCount: p.commentsCount,
    myReaction: o.myReaction,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

export const presentFeedItem = (i: FeedItemOutput): S['FeedItem'] => ({ post: presentPost(i.output), source: i.source, score: i.score });

export function presentModerationPost(m: ModerationPostOutput): S['ModerationPost'] {
  const reason = m.hiddenReason === 'AUTHOR_SUSPENDED' ? 'MODERATOR' : m.hiddenReason;
  return { ...presentPost(m.output), reportsCount: m.reportsCount, hiddenReason: m.output.post.status === 'HIDDEN' ? ((reason ?? 'MODERATOR') as S['HiddenReason']) : null };
}

export function presentProfile(o: ProfileOutput): S['Profile'] {
  const p = o.profile;
  return {
    userId: p.userId,
    displayName: p.displayName,
    universityId: p.universityId ?? '',
    career: p.career,
    semester: p.semester,
    bio: p.bio,
    interests: [...p.interests],
    avatarMediaId: p.avatarMediaId,
    avatarUrl: o.avatarUrl,
    followersCount: o.followersCount,
    followingCount: o.followingCount,
    postsCount: o.postsCount,
    followedByMe: o.followedByMe,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

export function presentComment(o: CommentOutput): S['Comment'] {
  const c = o.comment;
  return {
    id: c.id,
    postId: c.postId,
    authorId: c.authorId,
    author: presentAuthor(o.author),
    text: c.text,
    status: c.status,
    createdAt: iso(c.createdAt),
    ...(c.parentId ? { parentId: c.parentId } : {}),
    replyCount: c.replyCount,
  };
}

export const presentReaction = (r: ReactionStateOutput): S['ReactionState'] => ({ postId: r.postId, myReaction: r.myReaction, reactionCounts: { ...r.reactionCounts } });

export const presentFollow = (f: FollowProps): S['Follow'] => ({ followerId: f.followerId, followeeId: f.followeeId, createdAt: iso(f.createdAt) });

export const presentGroup = (g: GroupOutput): S['Group'] => ({
  id: g.group.id,
  name: g.group.name,
  subject: g.group.subject,
  privacy: g.group.privacy,
  ownerId: g.group.ownerId,
  membersCount: g.group.membersCount,
  myMembership: g.myMembership,
  createdAt: iso(g.group.createdAt),
});

export const presentMembership = (m: MembershipProps, profile?: AuthorSummary | null): S['GroupMembership'] => ({
  groupId: m.groupId,
  userId: m.userId,
  role: m.role,
  status: m.status,
  ...(profile ? { profile: presentAuthor(profile) } : {}),
  requestedAt: iso(m.requestedAt),
  updatedAt: iso(m.updatedAt),
});

export const presentMembershipOutput = (m: MembershipOutput): S['GroupMembership'] => presentMembership(m.membership, m.profile);

export const presentReport = (r: ContentReportProps): S['ContentReport'] => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  reporterId: r.reporterId,
  reason: r.reason,
  details: r.details,
  status: r.status,
  resolution: r.resolution,
  resolutionNote: r.resolutionNote,
  createdAt: iso(r.createdAt),
  resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : null,
});

export const presentStats = (s: ContentDailyStatsOutput): S['ContentDailyStats'] => ({ from: s.from, to: s.to, days: s.days, topHashtags: s.topHashtags });
