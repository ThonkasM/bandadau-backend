import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { type Harness, ISSUE, issueCommand, startHarness } from './support/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ chaos: true });
});

afterAll(async () => {
  await h?.close();
});

it('CHAOS_TICKETING_FAIL=true makes issue-ticket answer ticket-issue-failed (CHAOS_INJECTED) and creates nothing', async () => {
  const cmd = issueCommand();
  await h.sendCommand(ISSUE, cmd);
  const failed = await h.waitFor((e) => e.type === 'bandada.ticketing.ticket-issue-failed.v1');
  expect(failed.data).toMatchObject({ sagaId: cmd.sagaId, registrationId: cmd.registrationId, reason: 'CHAOS_INJECTED' });
  expect(failed.sagaid).toBe(cmd.sagaId);
  const tickets = await h.doc.send(
    new QueryCommand({ TableName: h.table, IndexName: 'GSI1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `USER#${String(cmd.userId)}` } }),
  );
  expect(tickets.Count).toBe(0);
  expect(h.eventsOfType('bandada.ticketing.ticket-issued.v1')).toHaveLength(0);
});
