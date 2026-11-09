import { Internal } from '@bandada/auth-ts/nest';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { GetTicketStatsUseCase } from '../../../use-cases/get-ticket-stats/get-ticket-stats.use-case';
import { ListTicketValidationsUseCase } from '../../../use-cases/list-ticket-validations/list-ticket-validations.use-case';
import { type RequestLike, toHttpProblem, validationProblem } from './http-problem';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service-to-service statistics (`/internal/v1`, outside the `/api/v1` prefix and blocked at Traefik).
 * `@Internal('internal:read')` requires a `typ=service` token with `aud=bandada-internal` and that scope (403 otherwise).
 */
@Controller('internal/v1')
@Internal('internal:read')
export class InternalStatsController {
  constructor(
    @Inject(GetTicketStatsUseCase) private readonly stats: GetTicketStatsUseCase,
    @Inject(ListTicketValidationsUseCase) private readonly validations: ListTicketValidationsUseCase,
  ) {}

  @Get('stats/tickets')
  async getTicketStats(@Req() req: RequestLike, @Query('from') from?: string, @Query('to') to?: string, @Query('eventId') eventId?: string) {
    const errors: { field: string; code: string; message: string }[] = [];
    if (!from || !DATE.test(from)) errors.push({ field: 'from', code: 'INVALID_VALUE', message: 'from must be YYYY-MM-DD' });
    if (!to || !DATE.test(to)) errors.push({ field: 'to', code: 'INVALID_VALUE', message: 'to must be YYYY-MM-DD' });
    if (eventId !== undefined && !UUID.test(eventId)) errors.push({ field: 'eventId', code: 'INVALID_VALUE', message: 'eventId must be a UUID' });
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      return await this.stats.execute({ from: from as string, to: to as string, ...(eventId ? { eventId } : {}) });
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  /** Attendance report feed: validated tickets (who scanned whose ticket) in a date range. */
  @Get('validations')
  async listValidations(
    @Req() req: RequestLike,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventId') eventId?: string,
    @Query('limit') limit?: string,
  ) {
    const errors: { field: string; code: string; message: string }[] = [];
    if (!from || !DATE.test(from)) errors.push({ field: 'from', code: 'INVALID_VALUE', message: 'from must be YYYY-MM-DD' });
    if (!to || !DATE.test(to)) errors.push({ field: 'to', code: 'INVALID_VALUE', message: 'to must be YYYY-MM-DD' });
    if (eventId !== undefined && !UUID.test(eventId)) errors.push({ field: 'eventId', code: 'INVALID_VALUE', message: 'eventId must be a UUID' });
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500)) {
      errors.push({ field: 'limit', code: 'INVALID_VALUE', message: 'limit must be an integer between 1 and 500' });
    }
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      return await this.validations.execute({
        from: from as string,
        to: to as string,
        ...(eventId ? { eventId } : {}),
        ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      });
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }
}
