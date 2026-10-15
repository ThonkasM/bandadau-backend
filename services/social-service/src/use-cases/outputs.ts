import type { PostProps, ReactionType } from '../entities/post.entity';
import type { MediaKind, MediaStatus } from '../entities/value-objects/media';

export interface AuthorSummary {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostMediaOutput {
  mediaId: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface PostOutput {
  post: PostProps;
  author: AuthorSummary;
  media: PostMediaOutput[];
  myReaction: ReactionType | null;
}
