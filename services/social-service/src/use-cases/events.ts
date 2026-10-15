import type { CommentProps } from '../entities/comment.entity';
import type { ContentReportProps } from '../entities/content-report.entity';
import type { Group, MembershipStatus } from '../entities/group.entity';
import type { HiddenReason, Post, ReactionType } from '../entities/post.entity';
import type { DomainEvent } from './ports/event-publisher';

const iso = (d: Date): string => d.toISOString();

export const SocialEvents = {
  postCreated(post: Post, now: Date): DomainEvent {
    const p = post.snapshot;
    return {
      type: 'bandada.social.post.created.v1',
      subject: `posts/${p.id}`,
      data: { postId: p.id, authorId: p.authorId, clientId: p.clientId, groupId: p.groupId, visibility: p.visibility, status: p.status, hashtags: p.hashtags, mediaIds: p.mediaIds, occurredAt: iso(now) },
    };
  },
  postPublished(post: Post, now: Date): DomainEvent {
    const p = post.snapshot;
    return {
      type: 'bandada.social.post.published.v1',
      subject: `posts/${p.id}`,
      data: { postId: p.id, authorId: p.authorId, groupId: p.groupId, visibility: p.visibility, hashtags: p.hashtags, mediaIds: p.mediaIds, occurredAt: iso(now) },
    };
  },
  postHidden(postId: string, authorId: string, reason: HiddenReason, now: Date): DomainEvent {
    return { type: 'bandada.social.post.hidden.v1', subject: `posts/${postId}`, data: { postId, authorId, reason, occurredAt: iso(now) } };
  },
  postDeleted(post: Post, deletedBy: string, reason: 'AUTHOR' | 'MODERATOR', now: Date): DomainEvent {
    return {
      type: 'bandada.social.post.deleted.v1',
      subject: `posts/${post.id}`,
      data: { postId: post.id, authorId: post.authorId, mediaIds: [...post.mediaIds], deletedBy, reason, occurredAt: iso(now) },
    };
  },
  postRemoved(post: Post, removedBy: string, reportId: string | null, note: string | null, now: Date): DomainEvent {
    return {
      type: 'bandada.social.post.removed.v1',
      subject: `posts/${post.id}`,
      data: { postId: post.id, authorId: post.authorId, mediaIds: [...post.mediaIds], removedBy, reportId, note, occurredAt: iso(now) },
    };
  },
  commentCreated(comment: CommentProps, postAuthorId: string, now: Date): DomainEvent {
    return {
      type: 'bandada.social.comment.created.v1',
      subject: `comments/${comment.id}`,
      data: { commentId: comment.id, postId: comment.postId, postAuthorId, authorId: comment.authorId, occurredAt: iso(now) },
    };
  },
  commentHidden(comment: CommentProps, status: 'HIDDEN' | 'REMOVED', reason: 'REPORTED' | 'MODERATOR', openReportsCount: number, now: Date): DomainEvent {
    return {
      type: 'bandada.social.comment.hidden.v1',
      subject: `comments/${comment.id}`,
      data: { commentId: comment.id, postId: comment.postId, authorId: comment.authorId, status, reason, openReportsCount, occurredAt: iso(now) },
    };
  },
  reactionSet(post: Post, userId: string, type: ReactionType, previousType: ReactionType | null, now: Date): DomainEvent {
    return {
      type: 'bandada.social.reaction.set.v1',
      subject: `posts/${post.id}`,
      data: { postId: post.id, postAuthorId: post.authorId, userId, type, previousType, occurredAt: iso(now) },
    };
  },
  followCreated(followerId: string, followeeId: string, now: Date): DomainEvent {
    return { type: 'bandada.social.follow.created.v1', subject: `users/${followeeId}`, data: { followerId, followeeId, occurredAt: iso(now) } };
  },
  groupJoinRequested(group: Group, userId: string, membershipStatus: MembershipStatus, groupAdminIds: string[], now: Date): DomainEvent {
    const g = group.snapshot;
    return {
      type: 'bandada.social.group.join-requested.v1',
      subject: `groups/${g.id}`,
      data: { groupId: g.id, groupName: g.name, privacy: g.privacy, userId, membershipStatus, groupAdminIds, occurredAt: iso(now) },
    };
  },
  contentReported(report: ContentReportProps, openReportsCount: number, autoHidden: boolean, now: Date): DomainEvent {
    return {
      type: 'bandada.social.content.reported.v1',
      subject: `reports/${report.id}`,
      data: {
        reportId: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        targetAuthorId: report.targetAuthorId,
        reporterId: report.reporterId,
        reason: report.reason,
        details: report.details,
        openReportsCount,
        autoHidden,
        occurredAt: iso(now),
      },
    };
  },
};
