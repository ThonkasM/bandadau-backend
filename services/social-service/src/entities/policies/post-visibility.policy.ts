import type { PostProps } from '../post.entity';

export interface ViewerContext {
  userId: string;
  followsAuthor: boolean;
  /** Is the viewer an ACTIVE member of the post's group (only relevant for GROUP posts). */
  activeGroupMember: boolean;
}

/** Who can see a post (RN-06.1): author, PUBLIC for everybody, FOLLOWERS for followers, GROUP for ACTIVE members. */
export function canViewPost(post: Pick<PostProps, 'authorId' | 'visibility'>, viewer: ViewerContext): boolean {
  if (post.authorId === viewer.userId) return true;
  switch (post.visibility) {
    case 'PUBLIC':
      return true;
    case 'FOLLOWERS':
      return viewer.followsAuthor;
    case 'GROUP':
      return viewer.activeGroupMember;
  }
}

/** Statuses a non-author can see. The author also sees HIDDEN/PENDING_MEDIA posts (but not REMOVED). */
export function isStatusVisible(status: PostProps['status'], isAuthor: boolean): boolean {
  if (status === 'PUBLISHED') return true;
  if (status === 'REMOVED') return false;
  return isAuthor;
}
