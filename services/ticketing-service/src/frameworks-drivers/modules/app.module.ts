import { readFileSync } from 'node:fs';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AuthModule, JwtAuthGuard, RolesGuard } from '@bandada/auth-ts/nest';
import { IdempotencyModule } from '@bandada/idempotency-ts/nest';
import { DynamoInbox, DynamoOutbox, uuidv7 } from '@bandada/messaging-ts';
import { MessagingModule } from '@bandada/messaging-ts/nest';
import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ProblemFilter } from '../../interface-adapters/controllers/http/problem.filter';
import { TicketsController } from '../../interface-adapters/controllers/http/tickets.controller';
import { COMMANDS_QUEUE, TicketingCommandsConsumer } from '../../interface-adapters/controllers/messaging/ticketing-commands.consumer';
import { JoseQrSigner } from '../../interface-adapters/gateways/crypto/jose-qr-signer.gateway';
import { DynamoOutboxPublisher } from '../../interface-adapters/gateways/dynamo/dynamo-outbox.publisher';
import { DynamoTicketRepository } from '../../interface-adapters/gateways/dynamo/dynamo-ticket.repository';
import { GetSigningKeysUseCase } from '../../use-cases/get-signing-keys/get-signing-keys.use-case';
import { GetTicketUseCase } from '../../use-cases/get-ticket/get-ticket.use-case';
import { IssueTicketUseCase } from '../../use-cases/issue-ticket/issue-ticket.use-case';
import { ListMyTicketsUseCase } from '../../use-cases/list-my-tickets/list-my-tickets.use-case';
import { CLOCK,type Clock } from '../../use-cases/ports/clock';
import { EVENT_PUBLISHER } from '../../use-cases/ports/event-publisher';
import { ID_GENERATOR,type IdGenerator } from '../../use-cases/ports/id-generator';
import { type PublicSigningKey, QR_SIGNER,type QrSigner } from '../../use-cases/ports/qr-signer';
import { TICKET_REPOSITORY,type TicketRepository } from '../../use-cases/ports/ticket.repository';
import { ValidateTicketUseCase } from '../../use-cases/validate-ticket/validate-ticket.use-case';
import { VoidTicketUseCase } from '../../use-cases/void-ticket/void-ticket.use-case';
import type { AppConfig } from '../config/app-config';
import { HealthController } from '../health/health.controller';
import { APP_CONFIG, DYNAMO_CLIENT, DYNAMO_DOC, TICKETING_TABLE } from './tokens';

export interface AppOverrides {
  clock?: Clock;
  signer?: QrSigner;
}

const logger = new Logger('Messaging');

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    const dynamo = new DynamoDBClient({
      region: config.awsRegion,
      ...(config.dynamodbEndpoint ? { endpoint: config.dynamodbEndpoint } : {}),
    });
    const doc = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

    const outbox = new DynamoOutbox({ client: doc, tableName: config.ticketingTable });
    const inbox = new DynamoInbox({ client: doc, tableName: config.ticketingTable });

    return {
      module: AppModule,
      imports: [
        AuthModule.forRoot({ jwksUrl: config.jwksUrl, issuer: config.jwtIssuer }),
        IdempotencyModule.forRoot({ service: 'ticketing', client: doc, tableName: config.idempotencyTable }),
        MessagingModule.forRoot({
          rabbit: { url: config.rabbitmqUrl },
          queues: { [COMMANDS_QUEUE]: { inbox, prefetch: 20 } },
          relay: { outbox, pollIntervalMs: config.relayPollIntervalMs },
          logger: {
            debug: (m, c) => logger.debug(`${m} ${c ? JSON.stringify(c) : ''}`),
            info: (m, c) => logger.log(`${m} ${c ? JSON.stringify(c) : ''}`),
            warn: (m, c) => logger.warn(`${m} ${c ? JSON.stringify(c) : ''}`),
            error: (m, c) => logger.error(`${m} ${c ? JSON.stringify(c) : ''}`),
          },
        }),
      ],
      controllers: [TicketsController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: DYNAMO_CLIENT, useValue: dynamo },
        { provide: DYNAMO_DOC, useValue: doc },
        { provide: TICKETING_TABLE, useValue: config.ticketingTable },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: CLOCK, useValue: overrides.clock ?? { now: () => new Date() } satisfies Clock },
        { provide: ID_GENERATOR, useValue: { next: () => uuidv7() } satisfies IdGenerator },
        {
          provide: QR_SIGNER,
          useFactory: async () => overrides.signer ?? JoseQrSigner.create({
            privateKeyPem: readFileSync(config.qrSigningKeyPath, 'utf8'),
            kid: config.qrSigningKid,
            previousKeys: config.qrPreviousKeysPath ? readPreviousKeys(config.qrPreviousKeysPath) : [],
          }),
        },
        { provide: DynamoOutboxPublisher, useFactory: () => new DynamoOutboxPublisher(doc, config.ticketingTable, outbox) },
        { provide: EVENT_PUBLISHER, useExisting: DynamoOutboxPublisher },
        {
          provide: TICKET_REPOSITORY,
          useFactory: (publisher: DynamoOutboxPublisher) => new DynamoTicketRepository(doc, config.ticketingTable, publisher),
          inject: [DynamoOutboxPublisher],
        },
        {
          provide: IssueTicketUseCase,
          useFactory: (repo: TicketRepository, publisher: DynamoOutboxPublisher, clock: Clock, ids: IdGenerator) =>
            new IssueTicketUseCase(repo, publisher, clock, ids, { chaosFail: config.chaosTicketingFail }),
          inject: [TICKET_REPOSITORY, EVENT_PUBLISHER, CLOCK, ID_GENERATOR],
        },
        {
          provide: VoidTicketUseCase,
          useFactory: (repo: TicketRepository, publisher: DynamoOutboxPublisher, clock: Clock) => new VoidTicketUseCase(repo, publisher, clock),
          inject: [TICKET_REPOSITORY, EVENT_PUBLISHER, CLOCK],
        },
        {
          provide: ValidateTicketUseCase,
          useFactory: (repo: TicketRepository, signer: QrSigner, publisher: DynamoOutboxPublisher, clock: Clock) =>
            new ValidateTicketUseCase(repo, signer, publisher, clock, {
              strictOrganizerCheck: config.strictOrganizerCheck,
              window: { opensBeforeStartMs: config.validationOpensBeforeMs, defaultDurationMs: config.validationDefaultDurationMs },
            }),
          inject: [TICKET_REPOSITORY, QR_SIGNER, EVENT_PUBLISHER, CLOCK],
        },
        { provide: GetTicketUseCase, useFactory: (repo: TicketRepository, signer: QrSigner) => new GetTicketUseCase(repo, signer), inject: [TICKET_REPOSITORY, QR_SIGNER] },
        { provide: ListMyTicketsUseCase, useFactory: (repo: TicketRepository) => new ListMyTicketsUseCase(repo), inject: [TICKET_REPOSITORY] },
        { provide: GetSigningKeysUseCase, useFactory: (signer: QrSigner) => new GetSigningKeysUseCase(signer), inject: [QR_SIGNER] },
        TicketingCommandsConsumer,
      ],
    };
  }
}

function readPreviousKeys(path: string): PublicSigningKey[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { keys?: PublicSigningKey[] };
  return parsed.keys ?? [];
}
