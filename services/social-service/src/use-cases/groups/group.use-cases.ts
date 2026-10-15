import { DomainError } from '../../entities/errors/domain-error';
import { canManageMembers, Group, initialMembershipStatus, type GroupPrivacy, type MembershipProps, type MembershipStatus } from '../../entities/group.entity';
import { SocialEvents } from '../events';
import type { AuthorSummary } from '../outputs';
import { paginate } from '../paginate';
import type { Clock, EventPublisher, GroupRepository, IdGenerator, KeysetCursor, MembershipRepository, Page, UnitOfWork } from '../ports';
import { DEFAULT_LIMIT } from '../ports';
import type { PostAssembler } from '../posts/post-assembler';

export interface GroupOutput {
  group: Group['snapshot'];
  myMembership: { role: MembershipProps['role']; status: MembershipStatus } | null;
}

export interface MembershipOutput {
  membership: MembershipProps;
  profile: AuthorSummary | null;
}

const mine = (m: MembershipProps | null | undefined): GroupOutput['myMembership'] => (m ? { role: m.role, status: m.status } : null);

export class CreateGroupUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: { ownerId: string; name: string; subject: string; privacy: GroupPrivacy }): Promise<GroupOutput> {
    const now = this.clock.now();
    const { group, owner } = Group.create({ id: this.ids.next(), name: input.name, subject: input.subject, privacy: input.privacy, ownerId: input.ownerId }, now);
    await this.uow.run(async () => {
      await this.groups.insert(group);
      await this.memberships.insert(owner);
    });
    return { group: group.snapshot, myMembership: mine(owner) };
  }
}

export class SearchGroupsUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(input: { userId: string; query?: string; cursor: KeysetCursor | null; limit?: number }): Promise<Page<GroupOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const rows = await this.groups.search(input.query, input.cursor, limit + 1);
    const page = paginate(rows, limit, (g) => ({ createdAt: g.snapshot.createdAt, id: g.id }));
    const memberships = await this.memberships.findForGroups(input.userId, page.items.map((g) => g.id));
    return { items: page.items.map((g) => ({ group: g.snapshot, myMembership: mine(memberships.get(g.id)) })), nextCursor: page.nextCursor };
  }
}

/** Internal listing for n8n: PUBLIC groups of a career, biggest first. `myMembership` is always null. */
export class ListGroupsInternalUseCase {
  constructor(private readonly groups: GroupRepository) {}

  async execute(input: { career?: string; limit?: number; offset?: number }): Promise<GroupOutput[]> {
    const rows = input.career ? await this.groups.listPublicByCareer(input.career, input.limit ?? DEFAULT_LIMIT, input.offset ?? 0) : [];
    return rows.map((g) => ({ group: g.snapshot, myMembership: null }));
  }
}

export class GetGroupUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(input: { groupId: string; userId: string }): Promise<GroupOutput> {
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    return { group: group.snapshot, myMembership: mine(await this.memberships.find(group.id, input.userId)) };
  }
}

export class JoinGroupUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly events: EventPublisher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { groupId: string; userId: string }): Promise<MembershipProps> {
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    const now = this.clock.now();
    const status = initialMembershipStatus(group.privacy);

    return this.uow.run(async () => {
      const current = await this.memberships.find(group.id, input.userId);
      if (current && (current.status === 'ACTIVE' || current.status === 'PENDING')) return current;

      let result: MembershipProps | null;
      if (current) {
        result = await this.memberships.transition(group.id, input.userId, { from: ['REJECTED', 'LEFT'], to: status, role: 'MEMBER' }, now);
      } else {
        const created: MembershipProps = { groupId: group.id, userId: input.userId, role: 'MEMBER', status, requestedAt: now, updatedAt: now };
        result = (await this.memberships.insert(created)) ? created : null;
      }
      if (!result) return (await this.memberships.find(group.id, input.userId)) as MembershipProps;

      if (result.status === 'ACTIVE') await this.groups.incrementMembers(group.id, 1);
      else await this.events.publish(SocialEvents.groupJoinRequested(group, input.userId, 'PENDING', await this.memberships.listManagerIds(group.id), now));
      return result;
    });
  }
}

export class ListGroupMembersUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly assembler: PostAssembler,
  ) {}

  async execute(input: { groupId: string; userId: string; status?: MembershipStatus; cursor: KeysetCursor | null; limit?: number }): Promise<Page<MembershipOutput>> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const status = input.status ?? 'ACTIVE';
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    const requester = await this.memberships.find(group.id, input.userId);
    if (status === 'ACTIVE') {
      if (requester?.status !== 'ACTIVE') throw new DomainError('GROUP_MEMBERSHIP_REQUIRED');
    } else if (!canManageMembers(requester)) {
      throw new DomainError('FORBIDDEN');
    }
    const rows = await this.memberships.list(group.id, status, input.cursor, limit + 1);
    const page = paginate(rows, limit, (m) => ({ createdAt: m.requestedAt, id: m.userId }));
    const profiles = await this.assembler.summaries(page.items.map((m) => m.userId));
    return { items: page.items.map((membership) => ({ membership, profile: profiles.get(membership.userId) ?? null })), nextCursor: page.nextCursor };
  }
}

export class ReviewGroupMemberUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /** `approve`: PENDING -> ACTIVE (+1 member). `reject`: PENDING -> REJECTED. Repeating the same decision answers 200 unchanged. */
  async execute(input: { groupId: string; actorId: string; targetUserId: string; decision: 'approve' | 'reject' }): Promise<MembershipProps> {
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    if (!canManageMembers(await this.memberships.find(group.id, input.actorId))) throw new DomainError('FORBIDDEN');
    const target = await this.memberships.find(group.id, input.targetUserId);
    if (!target) throw new DomainError('NOT_FOUND');
    const to: MembershipStatus = input.decision === 'approve' ? 'ACTIVE' : 'REJECTED';
    if (target.status === to) return target;
    if (target.status !== 'PENDING') throw new DomainError('MEMBERSHIP_NOT_PENDING');
    return this.uow.run(async () => {
      const updated = await this.memberships.transition(group.id, input.targetUserId, { from: ['PENDING'], to }, this.clock.now());
      if (!updated) {
        const now = (await this.memberships.find(group.id, input.targetUserId)) as MembershipProps;
        if (now.status === to) return now;
        throw new DomainError('MEMBERSHIP_NOT_PENDING');
      }
      if (to === 'ACTIVE') await this.groups.incrementMembers(group.id, 1);
      return updated;
    });
  }
}

export class LeaveGroupUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly memberships: MembershipRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { groupId: string; userId: string }): Promise<MembershipProps> {
    const group = await this.groups.findById(input.groupId);
    if (!group) throw new DomainError('NOT_FOUND');
    const current = await this.memberships.find(group.id, input.userId);
    if (!current) throw new DomainError('NOT_FOUND');
    if (current.status === 'LEFT' || current.status === 'REJECTED') return current;
    if (current.status === 'ACTIVE' && current.role === 'OWNER') throw new DomainError('OWNER_CANNOT_LEAVE');
    return this.uow.run(async () => {
      const updated = await this.memberships.transition(group.id, input.userId, { from: ['ACTIVE', 'PENDING'], to: 'LEFT' }, this.clock.now());
      if (!updated) return (await this.memberships.find(group.id, input.userId)) as MembershipProps;
      if (current.status === 'ACTIVE') await this.groups.incrementMembers(group.id, -1);
      return updated;
    });
  }
}
