import { canViewPost, isStatusVisible } from '../../entities/policies/post-visibility.policy';
import type { Post } from '../../entities/post.entity';
import type { FollowRepository, GroupRepository, MembershipRepository } from '../ports';

/** Visibility checks for a single post (author, PUBLIC, FOLLOWERS by follow, GROUP by membership or public group). */
export class PostAccess {
  constructor(
    private readonly follows: FollowRepository,
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async canView(post: Post, userId: string): Promise<boolean> {
    if (!isStatusVisible(post.status, post.authorId === userId)) return false;
    const followsAuthor = post.visibility === 'FOLLOWERS' && post.authorId !== userId ? await this.follows.isFollowing(userId, post.authorId) : false;
    let activeGroupMember = false;
    if (post.visibility === 'GROUP' && post.groupId) activeGroupMember = await this.groupAccessible(post.groupId, userId);
    return canViewPost({ authorId: post.authorId, visibility: post.visibility }, { userId, followsAuthor, activeGroupMember });
  }

  /** Public groups are readable by everybody; private ones need an ACTIVE membership. */
  async groupAccessible(groupId: string, userId: string): Promise<boolean> {
    const group = await this.groups.findById(groupId);
    if (!group) return false;
    if (!group.isPrivate) return true;
    const membership = await this.memberships.find(groupId, userId);
    return membership?.status === 'ACTIVE';
  }
}
