import { DomainError } from './errors/domain-error';

export type GroupPrivacy = 'PUBLIC' | 'PRIVATE';
export type MembershipStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'LEFT';
export type GroupMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface GroupProps {
  id: string;
  name: string;
  subject: string;
  privacy: GroupPrivacy;
  ownerId: string;
  membersCount: number;
  createdAt: Date;
}

export interface MembershipProps {
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  status: MembershipStatus;
  requestedAt: Date;
  updatedAt: Date;
}

export class Group {
  private constructor(private readonly props: GroupProps) {}

  static restore(props: GroupProps): Group {
    return new Group({ ...props });
  }

  static create(input: { id: string; name: string; subject: string; privacy: GroupPrivacy; ownerId: string }, now: Date): { group: Group; owner: MembershipProps } {
    const name = input.name.trim();
    const subject = input.subject.trim();
    if (name.length < 3 || name.length > 80) throw new DomainError('VALIDATION_FAILED', { field: 'name', code: name.length < 3 ? 'TOO_SHORT' : 'TOO_LONG' });
    if (subject.length < 2 || subject.length > 80) throw new DomainError('VALIDATION_FAILED', { field: 'subject', code: subject.length < 2 ? 'TOO_SHORT' : 'TOO_LONG' });
    const group = new Group({ id: input.id, name, subject, privacy: input.privacy, ownerId: input.ownerId, membersCount: 1, createdAt: now });
    const owner: MembershipProps = { groupId: input.id, userId: input.ownerId, role: 'OWNER', status: 'ACTIVE', requestedAt: now, updatedAt: now };
    return { group, owner };
  }

  get id(): string { return this.props.id; }
  get privacy(): GroupPrivacy { return this.props.privacy; }
  get snapshot(): Readonly<GroupProps> { return this.props; }
  get isPrivate(): boolean { return this.props.privacy === 'PRIVATE'; }
}

export const canManageMembers = (m: Pick<MembershipProps, 'role' | 'status'> | null): boolean =>
  !!m && m.status === 'ACTIVE' && (m.role === 'OWNER' || m.role === 'ADMIN');

/** Status a new (or reopened) join request starts with: PUBLIC groups admit right away, PRIVATE ones need approval. */
export const initialMembershipStatus = (privacy: GroupPrivacy): MembershipStatus => (privacy === 'PUBLIC' ? 'ACTIVE' : 'PENDING');
