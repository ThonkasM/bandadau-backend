import { featureDisabled } from '../../common/errors';

const off = (feature: string) => () => {
  throw featureDisabled(feature);
};

/**
 * Fields still disabled: MCP tokens (identity `createMcpToken`/`revokeMcpToken` answer FEATURE_DISABLED until the MCP token
 * is issued by identity). The insights fields (reports, alerts, agentRuns, requestReport, acknowledgeAlert, runMonitoringNow,
 * alertRaised, reportReady) are served by `modules/insights` since phase 2.
 */
export const disabledResolvers = {
  Mutation: {
    createMcpToken: off('createMcpToken'),
    revokeMcpToken: off('revokeMcpToken'),
  },
};
