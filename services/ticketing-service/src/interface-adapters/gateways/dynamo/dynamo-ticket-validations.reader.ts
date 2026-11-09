import { type DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { TicketStatus } from '../../../entities/ticket-status';
import type {
  TicketValidationRow,
  TicketValidationsFilter,
  TicketValidationsReader,
  TicketValidationsScan,
} from '../../../use-cases/ports/ticket-validations.reader';

/**
 * Read-only list of validated tickets: a filtered, paginated `Scan` with a projection. Bounded by `maxRows` matching tickets;
 * administrative and low-frequency (attendance report), not on the critical path.
 */
export class DynamoTicketValidationsReader implements TicketValidationsReader {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async scan(filter: TicketValidationsFilter, maxRows: number): Promise<TicketValidationsScan> {
    const rows: TicketValidationRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          ProjectionExpression: '#ticketId, #eventId, #eventTitle, #userId, #usedBy, #usedAt',
          FilterExpression: `#entity = :ticket AND #status = :used AND #usedAt BETWEEN :from AND :to${filter.eventId ? ' AND #eventId = :eventId' : ''}`,
          ExpressionAttributeNames: {
            '#entity': 'entity',
            '#status': 'status',
            '#ticketId': 'ticketId',
            '#eventId': 'eventId',
            '#eventTitle': 'eventTitle',
            '#userId': 'userId',
            '#usedBy': 'usedBy',
            '#usedAt': 'usedAt',
          },
          ExpressionAttributeValues: {
            ':ticket': 'TICKET',
            ':used': TicketStatus.USED,
            ':from': filter.usedFrom.toISOString(),
            // BETWEEN is inclusive: the exclusive upper bound is the last millisecond before `usedBefore`.
            ':to': new Date(filter.usedBefore.getTime() - 1).toISOString(),
            ...(filter.eventId ? { ':eventId': filter.eventId } : {}),
          },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of out.Items ?? []) {
        if (typeof item.usedBy !== 'string' || typeof item.usedAt !== 'string') continue;
        rows.push({
          ticketId: item.ticketId as string,
          eventId: item.eventId as string,
          eventTitle: (item.eventTitle as string | undefined) ?? '',
          attendeeId: item.userId as string,
          validatedBy: item.usedBy,
          validatedAt: new Date(item.usedAt),
        });
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
