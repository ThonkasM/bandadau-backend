export interface ProfileProps {
  userId: string;
  displayName: string;
  universityId: string | null;
  career: string | null;
  semester: number | null;
  bio: string | null;
  interests: string[];
  avatarMediaId: string | null;
  pendingAvatarMediaId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfilePatch {
  displayName?: string;
  career?: string | null;
  semester?: number | null;
  bio?: string | null;
  interests?: string[];
}

export class Profile {
  private constructor(private readonly props: ProfileProps) {}

  static restore(props: ProfileProps): Profile {
    return new Profile({ ...props, interests: [...props.interests] });
  }

  static register(input: { userId: string; displayName: string; universityId?: string | null; career?: string | null }, now: Date): Profile {
    return new Profile({
      userId: input.userId,
      displayName: input.displayName.trim().slice(0, 50) || 'Estudiante',
      universityId: input.universityId ?? null,
      career: input.career ?? null,
      semester: null,
      bio: null,
      interests: [],
      avatarMediaId: null,
      pendingAvatarMediaId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  get userId(): string { return this.props.userId; }
  get snapshot(): Readonly<ProfileProps> { return this.props; }

  update(patch: ProfilePatch, now: Date): void {
    if (patch.displayName !== undefined) this.props.displayName = patch.displayName.trim();
    if (patch.career !== undefined) this.props.career = patch.career;
    if (patch.semester !== undefined) this.props.semester = patch.semester;
    if (patch.bio !== undefined) this.props.bio = patch.bio;
    if (patch.interests !== undefined) this.props.interests = [...patch.interests];
    this.props.updatedAt = now;
  }

  /** Avatar moderation (D-UC-04): the visible avatar changes only once the asset is APPROVED. */
  setPendingAvatar(mediaId: string | null, now: Date): void {
    if (mediaId === null) {
      this.props.avatarMediaId = null;
      this.props.pendingAvatarMediaId = null;
    } else {
      this.props.pendingAvatarMediaId = mediaId;
    }
    this.props.updatedAt = now;
  }

  promoteAvatar(now: Date): boolean {
    if (!this.props.pendingAvatarMediaId) return false;
    this.props.avatarMediaId = this.props.pendingAvatarMediaId;
    this.props.pendingAvatarMediaId = null;
    this.props.updatedAt = now;
    return true;
  }

  discardPendingAvatar(now: Date): boolean {
    if (!this.props.pendingAvatarMediaId) return false;
    this.props.pendingAvatarMediaId = null;
    this.props.updatedAt = now;
    return true;
  }
}
