import { type AuthPrincipal } from '@bandada/auth-ts';
import { CurrentUser, Roles } from '@bandada/auth-ts/nest';
import { Idempotent } from '@bandada/idempotency-ts/nest';
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { TicketNotFoundError } from '../../../entities/errors/domain-errors';
import { TicketStatus } from '../../../entities/ticket-status';
import { GetSigningKeysUseCase } from '../../../use-cases/get-signing-keys/get-signing-keys.use-case';
import { GetTicketUseCase } from '../../../use-cases/get-ticket/get-ticket.use-case';
import { ListMyTicketsUseCase } from '../../../use-cases/list-my-tickets/list-my-tickets.use-case';
import { ValidateTicketUseCase } from '../../../use-cases/validate-ticket/validate-ticket.use-case';
import { toTicketDetailDto, toTicketDto } from '../../presenters/ticket.presenter';
import { type RequestLike, toHttpProblem, validationProblem } from './http-problem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('tickets')
export class TicketsController {
  constructor(
    @Inject(ListMyTicketsUseCase) private readonly listMine: ListMyTicketsUseCase,
    @Inject(GetTicketUseCase) private readonly getOne: GetTicketUseCase,
    @Inject(ValidateTicketUseCase) private readonly validate: ValidateTicketUseCase,
    @Inject(GetSigningKeysUseCase) private readonly signingKeys: GetSigningKeysUseCase,
  ) {}

  @Get('me')
  async listMyTickets(
    @CurrentUser() user: AuthPrincipal,
    @Req() req: RequestLike,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const errors: { field: string; code: string; message: string }[] = [];
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.push({ field: 'limit', code: 'OUT_OF_RANGE', message: 'limit must be between 1 and 100' });
    if (status !== undefined && !Object.values(TicketStatus).includes(status as TicketStatus)) {
      errors.push({ field: 'status', code: 'INVALID_VALUE', message: 'status must be ISSUED, USED or VOIDED' });
    }
    if (errors.length > 0) throw validationProblem(req, errors);
    try {
      const page = await this.listMine.execute({ userId: user.sub, status: status as TicketStatus | undefined, cursor, limit });
      return { items: page.items.map(toTicketDto), nextCursor: page.nextCursor };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Get('signing-keys')
  @Header('Cache-Control', 'public, max-age=3600')
  getTicketSigningKeys() {
    return this.signingKeys.execute();
  }

  @Get(':ticketId')
  async getTicket(@Param('ticketId') ticketId: string, @CurrentUser() user: AuthPrincipal, @Req() req: RequestLike) {
    try {
      if (!UUID.test(ticketId)) throw new TicketNotFoundError();
      const { ticket, qrPayload } = await this.getOne.execute({ ticketId, actor: { id: user.sub, roles: user.roles } });
      return toTicketDetailDto(ticket, qrPayload);
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }

  @Post('validate')
  @HttpCode(200)
  @Roles('ORGANIZER', 'ADMIN')
  @Idempotent()
  async validateTicket(@Body() body: unknown, @CurrentUser() user: AuthPrincipal, @Req() req: RequestLike) {
    const payload = (body ?? {}) as { qrPayload?: unknown; eventId?: unknown };
    const errors: { field: string; code: string; message: string }[] = [];
    if (typeof payload.qrPayload !== 'string' || payload.qrPayload.length === 0) {
      errors.push({ field: '/qrPayload', code: 'REQUIRED', message: 'qrPayload is required' });
    } else if (payload.qrPayload.length > 2048) {
      errors.push({ field: '/qrPayload', code: 'TOO_LONG', message: 'qrPayload must be at most 2048 characters' });
    }
    if (payload.eventId !== undefined && (typeof payload.eventId !== 'string' || !UUID.test(payload.eventId))) {
      errors.push({ field: '/eventId', code: 'INVALID_FORMAT', message: 'eventId must be a UUID' });
    }
    if (errors.length > 0) throw validationProblem(req, errors);

    try {
      const ticket = await this.validate.execute({
        qrPayload: payload.qrPayload as string,
        eventId: payload.eventId as string | undefined,
        actor: { id: user.sub, roles: user.roles },
        trace: { traceparent: req.headers['traceparent'] as string | undefined, correlationId: correlationOf(req) },
      });
      return { result: 'VALID', ticket: toTicketDto(ticket) };
    } catch (error) {
      throw toHttpProblem(error, req);
    }
  }
}

function correlationOf(req: RequestLike): string | undefined {
  const header = req.headers['x-correlation-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && UUID.test(value) ? value : undefined;
}
