import { featureDisabled } from '../../common/errors';

const off = (feature: string) => () => {
  throw featureDisabled(feature);
};

/** Phase 2 fields (insights, agents, MCP): declared by the SDL, answered with `extensions.code = FEATURE_DISABLED`. */
export const disabledResolvers = {
  Query: {
    reports: off('reports'),
    report: off('report'),
    alerts: off('alerts'),
    agentRuns: off('agentRuns'),
  },
  Mutation: {
    requestReport: off('requestReport'),
    acknowledgeAlert: off('acknowledgeAlert'),
    runMonitoringNow: off('runMonitoringNow'),
    createMcpToken: off('createMcpToken'),
    revokeMcpToken: off('revokeMcpToken'),
  },
  Subscription: {
    alertRaised: { subscribe: off('alertRaised'), resolve: (p: unknown) => p },
    reportReady: { subscribe: off('reportReady'), resolve: (p: unknown) => p },
  },
};
