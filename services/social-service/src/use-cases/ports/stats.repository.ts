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

export interface ContentStatsRepository {
  daily(from: Date, toExclusive: Date): Promise<DailyContentStats[]>;
  topHashtags(from: Date, toExclusive: Date, limit: number): Promise<Array<{ hashtag: string; count: number }>>;
}
