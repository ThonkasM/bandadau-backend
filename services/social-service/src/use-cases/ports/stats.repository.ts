export const STATS_REPOSITORY = Symbol('ContentStatsRepository');

export interface DailyContentStats {
  date: string;
  postsCreated: number;
  commentsCreated: number;
  reactionsSet: number;
  followsCreated: number;
  activeAuthors: number;
  postsHidden: number;
}

export interface CareerCount {
  career: string;
  users: number;
}

export interface CareerStats {
  totalProfiles: number;
  items: CareerCount[];
}

export interface RankedPost {
  postId: string;
  authorId: string;
  /** Raw post text: the use case normalizes and truncates it. */
  text: string;
  reactions: number;
  comments: number;
}

export interface ContentStatsRepository {
  /** Profiles per declared career (null/blank ignored), desc, ties alphabetical. */
  careers(limit: number): Promise<CareerStats>;
  /** PUBLISHED posts in `[from, toExclusive)` per hashtag, desc, ties alphabetical. */
  rankHashtags(from: Date, toExclusive: Date, limit: number): Promise<Array<{ hashtag: string; posts: number }>>;
  /** PUBLISHED posts in `[from, toExclusive)` per author, desc, ties by id. */
  rankAuthors(from: Date, toExclusive: Date, limit: number): Promise<Array<{ userId: string; posts: number }>>;
  /** PUBLISHED + PUBLIC posts by total reactions, then comments, then id. */
  rankPosts(from: Date, toExclusive: Date, limit: number): Promise<RankedPost[]>;

  daily(from: Date, toExclusive: Date): Promise<DailyContentStats[]>;
  topHashtags(from: Date, toExclusive: Date, limit: number): Promise<Array<{ hashtag: string; count: number }>>;
}
