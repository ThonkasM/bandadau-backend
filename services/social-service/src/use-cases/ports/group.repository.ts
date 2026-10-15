import type { Group, MembershipProps, MembershipStatus, GroupMemberRole } from '../../entities/group.entity';
import type { KeysetCursor } from './pagination';

export const GROUP_REPOSITORY = Symbol('GroupRepository');
export const MEMBERSHIP_REPOSITORY = Symbol('MembershipRepository');

export interface GroupRepository {
  insert(group: Group): Promise<void>;
  findById(id: string): Promise<Group | null>;
  /** Case-insensitive substring over name/subject. Newest first by (createdAt, id). */
  search(query: string | undefined, cursor: KeysetCursor | null, limit: number): Promise<Group[]>;
  /** PUBLIC groups with most ACTIVE members among members of `career` (internal). */
  listPublicByCareer(career: string, limit: number, offset: number): Promise<Group[]>;
  incrementMembers(groupId: string, delta: number): Promise<void>;
}

export interface MembershipTransition {
  from: readonly MembershipStatus[];
  to: MembershipStatus;
  role?: GroupMemberRole;
}

export interface MembershipRepository {
  find(groupId: string, userId: string): Promise<MembershipProps | null>;
  findForGroups(userId: string, groupIds: readonly string[]): Promise<Map<string, MembershipProps>>;
  /** False when `(groupId, userId)` already existed. */
  insert(membership: MembershipProps): Promise<boolean>;
  /** Atomic compare-and-set on the status. Returns the updated membership, or null when the current status is not in `from`. */
  transition(groupId: string, userId: string, change: MembershipTransition, now: Date): Promise<MembershipProps | null>;
  list(groupId: string, status: MembershipStatus, cursor: KeysetCursor | null, limit: number): Promise<MembershipProps[]>;
  listActiveGroupIds(userId: string, limit: number): Promise<string[]>;
  listManagerIds(groupId: string): Promise<string[]>;
}
