import type { GatewayContext } from '../../graphql/context';
import type { DashboardService, DateRangeInput } from './dashboard.service';

export function dashboardResolvers(service: DashboardService) {
  return {
    Query: {
      dashboard: (_: unknown, a: { range: DateRangeInput }, ctx: GatewayContext) => service.dashboard(ctx, a.range),
      walletStats: (_: unknown, a: { range: DateRangeInput }, ctx: GatewayContext) => service.walletStats(ctx, a.range),
    },
  };
}
