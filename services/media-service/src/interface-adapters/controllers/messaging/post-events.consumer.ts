import { type CloudEvent, type MessageContext,PermanentError } from '@bandada/messaging-ts';
import { ConsumeMessage } from '@bandada/messaging-ts/nest';
import { Inject, Injectable } from '@nestjs/common';

import { OnPostDeletedUseCase } from '../../../use-cases/post-events.use-case';
import { newRequestContext, requestContext } from '../../request-context';

export const MEDIA_QUEUE = 'media-service.events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PostEventsConsumer {
  constructor(@Inject(OnPostDeletedUseCase) private readonly onPostDeleted: OnPostDeletedUseCase) {}

  @ConsumeMessage({ queue: MEDIA_QUEUE, type: 'bandada.social.post.deleted.v1' })
  async postDeleted(event: CloudEvent<Record<string, unknown>>, _ctx: MessageContext): Promise<void> {
    const { authorId, mediaIds } = event.data;
    if (typeof authorId !== 'string' || !UUID.test(authorId) || !Array.isArray(mediaIds) || !mediaIds.every((m) => typeof m === 'string' && UUID.test(m))) {
      throw new PermanentError('malformed post.deleted event');
    }
    const rc = newRequestContext({ ...(event.correlationid ? { correlationId: event.correlationid } : {}), ...(event.traceparent ? { traceparent: event.traceparent } : {}), causationId: event.id, fallbackCorrelationId: event.id });
    await requestContext.run(rc, () => this.onPostDeleted.execute({ authorId, mediaIds: mediaIds as string[] }));
  }
}
