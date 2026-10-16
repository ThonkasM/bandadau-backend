import type { CareerStats, ContentStatsRepository } from '../ports';

/** Profiles per career (aggregates only, no names). Feeds the MCP tool `get_user_stats`. */
export class GetCareerStatsUseCase {
  constructor(private readonly stats: ContentStatsRepository) {}

  execute(input: { limit: number }): Promise<CareerStats> {
    return this.stats.careers(input.limit);
  }
}
