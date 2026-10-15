import { PermanentError, type CloudEvent, type MessageContext } from '@bandada/messaging-ts';
import { ConsumeMessage } from '@bandada/messaging-ts/nest';
import { Inject, Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongodb';

import { DomainError } from '../../../entities/errors/domain-error';
import { OnUserReactivatedUseCase, OnUserRegisteredUseCase, OnUserSuspendedUseCase } from '../../../use-cases/identity-events/identity-events.use-cases';
import { ApplyMediaDecisionUseCase, type MediaDecisionInput } from '../../../use-cases/media-events/apply-media-decision.use-case';
import { MongoContext } from '../../gateways/mongo/mongo-context';
import { newRequestContext, requestContext } from '../../request-context';

export const SOCIAL_QUEUE = 'social-service.events';

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Runs `work` inside the inbox transaction (`ctx.tx`) with the event's correlation/causation in the request context.
 * Malformed payloads and business errors are permanent (DLQ); infrastructure errors propagate and are retried.
 */
async function handle(mongo: MongoContext, event: CloudEvent, ctx: MessageContext<ClientSession>, work: () => Promise<void>): Promise<void> {
  const rc = newRequestContext({
    ...(event.correlationid ? { correlationId: event.correlationid } : {}),
    ...(event.traceparent ? { traceparent: event.traceparent } : {}),
    causationId: event.id,
    fallbackCorrelationId: event.id,
  });
  try {
    await requestContext.run(rc, () => mongo.runWith(ctx.tx, work));
  } catch (error) {
    if (error instanceof DomainError) throw new PermanentError(`domain error ${error.code}`, { cause: error });
    throw error;
  }
}

type Data = Record<string, unknown>;

@Injectable()
export class MediaEventsConsumer {
  constructor(
    @Inject(MongoContext) private readonly mongo: MongoContext,
    @Inject(ApplyMediaDecisionUseCase) private readonly apply: ApplyMediaDecisionUseCase,
  ) {}

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.media.asset.approved.v1' })
  approved(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    return this.run(event, ctx, 'APPROVED');
  }

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.media.asset.flagged.v1' })
  flagged(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    return this.run(event, ctx, 'FLAGGED');
  }

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.media.asset.rejected.v1' })
  rejected(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    return this.run(event, ctx, 'REJECTED');
  }

  private run(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>, status: MediaDecisionInput['status']): Promise<void> {
    const d = event.data;
    if (!isUuid(d.mediaId) || !isUuid(d.ownerId) || (d.kind !== 'IMAGE' && d.kind !== 'VIDEO')) throw new PermanentError('malformed media event');
    const input: MediaDecisionInput = { mediaId: d.mediaId, ownerId: d.ownerId, kind: d.kind, status };
    return handle(this.mongo, event, ctx, () => this.apply.execute(input));
  }
}

@Injectable()
export class IdentityEventsConsumer {
  constructor(
    @Inject(MongoContext) private readonly mongo: MongoContext,
    @Inject(OnUserRegisteredUseCase) private readonly registered: OnUserRegisteredUseCase,
    @Inject(OnUserSuspendedUseCase) private readonly suspended: OnUserSuspendedUseCase,
    @Inject(OnUserReactivatedUseCase) private readonly reactivated: OnUserReactivatedUseCase,
  ) {}

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.identity.user.registered.v1' })
  onRegistered(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    const d = event.data;
    if (!isUuid(d.userId) || typeof d.displayName !== 'string') throw new PermanentError('malformed user.registered event');
    const input = { userId: d.userId, displayName: d.displayName, universityId: isUuid(d.universityId) ? d.universityId : null, career: typeof d.career === 'string' ? d.career : null };
    return handle(this.mongo, event, ctx, () => this.registered.execute(input));
  }

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.identity.user.suspended.v1' })
  onSuspended(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    if (!isUuid(event.data.userId)) throw new PermanentError('malformed user.suspended event');
    const userId = event.data.userId;
    return handle(this.mongo, event, ctx, () => this.suspended.execute({ userId }));
  }

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.identity.user.reactivated.v1' })
  onReactivated(event: CloudEvent<Data>, ctx: MessageContext<ClientSession>): Promise<void> {
    if (!isUuid(event.data.userId)) throw new PermanentError('malformed user.reactivated event');
    const userId = event.data.userId;
    return handle(this.mongo, event, ctx, () => this.reactivated.execute({ userId }));
  }

  /** Bound by `bandada.identity.user.#` but irrelevant here: acknowledged and dropped (a DLQ entry would be noise). */
  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.identity.user.role-changed.v1' })
  ignoreRoleChanged(): Promise<void> {
    return Promise.resolve();
  }

  @ConsumeMessage({ queue: SOCIAL_QUEUE, type: 'bandada.identity.user.preferences-changed.v1' })
  ignorePreferencesChanged(): Promise<void> {
    return Promise.resolve();
  }
}
