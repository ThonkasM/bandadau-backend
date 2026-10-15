export const EVENT_PUBLISHER = Symbol('EventPublisher');

export interface DomainEvent {
  /** Routing key, e.g. `bandada.social.post.created.v1`. */
  type: string;
  /** `posts/<id>`. */
  subject: string;
  data: Record<string, unknown>;
}

export interface EventPublisher {
  /** Writes to the transactional outbox in the ambient transaction. Call it inside `UnitOfWork.run`. */
  publish(event: DomainEvent): Promise<void>;
}
