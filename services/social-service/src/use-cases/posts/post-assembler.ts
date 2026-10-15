import type { Post } from '../../entities/post.entity';
import type { Profile } from '../../entities/profile.entity';
import type { MediaAssetView } from '../../entities/value-objects/media';
import type { AuthorSummary, PostMediaOutput, PostOutput } from '../outputs';
import type { MediaAssetViewRepository, MediaGateway, MediaUrlInfo, ProfileRepository, ReactionRepository } from '../ports';

const URL_BATCH = 50;

/** Read-side hydration shared by getPost, getFeed and listGroupPosts: authors, media (one batched call) and my reactions. */
export class PostAssembler {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly reactions: ReactionRepository,
    private readonly views: MediaAssetViewRepository,
    private readonly media: MediaGateway,
  ) {}

  async assemble(posts: readonly Post[], viewerId: string | null): Promise<PostOutput[]> {
    if (posts.length === 0) return [];
    const authorIds = [...new Set(posts.map((p) => p.authorId))];
    const mediaIds = [...new Set(posts.flatMap((p) => [...p.mediaIds]))];
    const [profiles, viewMap, mine] = await Promise.all([
      this.profiles.findByIds(authorIds),
      this.views.findMany(mediaIds),
      viewerId ? this.reactions.findMine(posts.map((p) => p.id), viewerId) : Promise.resolve(new Map()),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const avatarIds = profiles.map((p) => p.snapshot.avatarMediaId).filter((id): id is string => !!id);
    const urls = await this.urls([...mediaIds, ...avatarIds]);
    return posts.map((post) => ({
      post: post.snapshot,
      author: this.summary(post.authorId, byId.get(post.authorId), urls),
      media: post.mediaIds.map((id) => this.mediaOutput(id, viewMap.get(id), urls.get(id))),
      myReaction: mine.get(post.id) ?? null,
    }));
  }

  async summaries(userIds: readonly string[]): Promise<Map<string, AuthorSummary>> {
    const ids = [...new Set(userIds)];
    const profiles = await this.profiles.findByIds(ids);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const urls = await this.urls(profiles.map((p) => p.snapshot.avatarMediaId).filter((id): id is string => !!id));
    return new Map(ids.map((id) => [id, this.summary(id, byId.get(id), urls)]));
  }

  async avatarUrl(mediaId: string | null): Promise<string | null> {
    if (!mediaId) return null;
    const urls = await this.urls([mediaId]);
    return urls.get(mediaId)?.thumbnailUrl ?? urls.get(mediaId)?.url ?? null;
  }

  private summary(userId: string, profile: Profile | undefined, urls: Map<string, MediaUrlInfo>): AuthorSummary {
    const avatarId = profile?.snapshot.avatarMediaId ?? null;
    const u = avatarId ? urls.get(avatarId) : undefined;
    return { userId, displayName: profile?.snapshot.displayName ?? 'Estudiante', avatarUrl: u?.thumbnailUrl ?? u?.url ?? null };
  }

  private mediaOutput(id: string, view: MediaAssetView | undefined, url: MediaUrlInfo | undefined): PostMediaOutput {
    const status = view?.status ?? url?.status ?? 'PROCESSING';
    const approved = status === 'APPROVED';
    return { mediaId: id, kind: view?.kind ?? url?.kind ?? 'IMAGE', status, url: approved ? (url?.url ?? null) : null, thumbnailUrl: approved ? (url?.thumbnailUrl ?? null) : null };
  }

  private async urls(ids: readonly string[]): Promise<Map<string, MediaUrlInfo>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, MediaUrlInfo>();
    for (let i = 0; i < unique.length; i += URL_BATCH) {
      const batch = unique.slice(i, i + URL_BATCH);
      const infos = await this.media.getUrls(batch).catch(() => [] as MediaUrlInfo[]);
      for (const info of infos) out.set(info.mediaId, info);
    }
    return out;
  }
}
