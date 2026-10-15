import type { Db } from 'mongodb';

/** Idempotent index creation, run on every start (phase-1 "migrations"). */
export async function ensureIndexes(db: Db): Promise<void> {
  const posts = db.collection('posts');
  await Promise.all([
    posts.createIndex({ authorId: 1, clientId: 1 }, { unique: true, name: 'uniq_author_client' }),
    posts.createIndex({ status: 1, createdAt: -1, _id: -1 }, { name: 'status_created' }),
    posts.createIndex({ authorId: 1, status: 1, createdAt: -1, _id: -1 }, { name: 'author_status_created' }),
    posts.createIndex({ groupId: 1, status: 1, createdAt: -1, _id: -1 }, { name: 'group_status_created' }),
    posts.createIndex({ authorCareer: 1, authorUniversityId: 1, status: 1, visibility: 1, createdAt: -1 }, { name: 'career_popular' }),
    posts.createIndex({ mediaIds: 1 }, { name: 'media_ids' }),
    posts.createIndex({ status: 1, createdAt: 1 }, { name: 'pending_sweep' }),
    posts.createIndex({ hiddenAt: 1 }, { sparse: true, name: 'hidden_at' }),
    db.collection('comments').createIndex({ postId: 1, status: 1, createdAt: 1, _id: 1 }, { name: 'post_comments' }),
    db.collection('comments').createIndex({ authorId: 1, status: 1 }, { name: 'comment_author' }),
    db.collection('reactions').createIndex({ postId: 1, userId: 1 }, { unique: true, name: 'uniq_post_user' }),
    db.collection('reactions').createIndex({ userId: 1, postId: 1 }, { name: 'user_post' }),
    db.collection('follows').createIndex({ followerId: 1, followeeId: 1 }, { unique: true, name: 'uniq_follow' }),
    db.collection('follows').createIndex({ followeeId: 1 }, { name: 'followee' }),
    db.collection('groups').createIndex({ createdAt: -1, _id: -1 }, { name: 'group_created' }),
    db.collection('groups').createIndex({ privacy: 1, membersCount: -1 }, { name: 'group_members' }),
    db.collection('groupMemberships').createIndex({ groupId: 1, userId: 1 }, { unique: true, name: 'uniq_group_user' }),
    db.collection('groupMemberships').createIndex({ userId: 1, status: 1 }, { name: 'user_status' }),
    db.collection('groupMemberships').createIndex({ groupId: 1, status: 1, requestedAt: -1, userId: -1 }, { name: 'group_status_requested' }),
    db.collection('contentReports').createIndex({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true, name: 'uniq_report' }),
    db.collection('contentReports').createIndex({ status: 1, createdAt: 1, _id: 1 }, { name: 'report_status' }),
    db.collection('contentReports').createIndex({ targetType: 1, targetId: 1, status: 1 }, { name: 'report_target' }),
    db.collection('profiles').createIndex({ pendingAvatarMediaId: 1 }, { sparse: true, name: 'pending_avatar' }),
    db.collection('profiles').createIndex({ career: 1 }, { name: 'career' }),
  ]);
}
