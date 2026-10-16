import { type DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

import type { TicketStatus } from '../../../entities/ticket-status';
import type { TicketStatRow, TicketStatsFilter, TicketStatsReader, TicketStatsScan } from '../../../use-cases/ports/ticket-stats.reader';

/**
 * Read-only statistics over the ticketing table: a filtered, paginated `Scan` with a projection (only event id/title and
 * status travel). Bounded by `maxRows` matching tickets; administrative and low-frequency, not on the critical path.
 */
export class DynamoTicketStatsReader implements TicketStatsReader {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async scan(filter: TicketStatsFilter, maxRows: number): Promise<TicketStatsScan> {
    const rows: TicketStatRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: '#eventId, #eventTitle, #status',
          FilterExpression: `#entity = :ticket AND #issuedAt BETWEEN :from AND :to${filter.eventId ? ' AND #eventId = :eventId' : ''}`,
          ExpressionAttributeNames: { '#entity': 'entity', '#issuedAt': 'issuedAt', '#eventId': 'eventId', '#eventTitle': 'eventTitle', '#status': 'status' },
          ExpressionAttributeValues: {
            ':ticket': 'TICKET',
            ':from': filter.issuedFrom.toISOString(),
            // BETWEEN is inclusive: the exclusive upper bound is the last millisecond before `issuedBefore`.
            ':to': new Date(filter.issuedBefore.getTime() - 1).toISOString(),
            ...(filter.eventId ? { ':eventId': filter.eventId } : {}),
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of out.Items ?? []) {
        rows.push({ eventId: item.eventId as string, eventTitle: (item.eventTitle as string | undefined) ?? '', status: item.status as TicketStatus });
      }
      startKey = out.LastEvaluatedKey;
      if (rows.length >= maxRows) {
        const truncated = rows.length > maxRows || startKey !== undefined;
        return { rows: rows.slice(0, maxRows), truncated };
      }
    } while (startKey);
    return { rows, truncated: false };
  }
}
