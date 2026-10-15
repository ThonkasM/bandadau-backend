import { TicketAlreadyUsedError, TicketVoidedError } from './errors/domain-errors';
import { TicketStatus } from './ticket-status';

export interface TicketProps {
  id: string;
  registrationId: string;
  eventId: string;
  userId: string;
  eventTitle: string;
  eventStartsAt: Date;
  eventEndsAt: Date | null;
  venue: string;
  organizerId: string | null;
  staffUserIds: string[];
  status: TicketStatus;
  issuedAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  voidedAt: Date | null;
}

export type NewTicketInput = Omit<TicketProps, 'status' | 'usedAt' | 'usedBy' | 'voidedAt'>;

export class Ticket {
  private constructor(private readonly props: TicketProps) {}

  static issue(input: NewTicketInput): Ticket {
    return new Ticket({ ...input, status: TicketStatus.ISSUED, usedAt: null, usedBy: null, voidedAt: null });
  }

  static restore(props: TicketProps): Ticket {
    return new Ticket({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get registrationId(): string {
    return this.props.registrationId;
  }
  get eventId(): string {
    return this.props.eventId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get eventTitle(): string {
    return this.props.eventTitle;
  }
  get eventStartsAt(): Date {
    return this.props.eventStartsAt;
  }
  get eventEndsAt(): Date | null {
    return this.props.eventEndsAt;
  }
  get venue(): string {
    return this.props.venue;
  }
  get organizerId(): string | null {
    return this.props.organizerId;
  }
  get staffUserIds(): readonly string[] {
    return this.props.staffUserIds;
  }
  get status(): TicketStatus {
    return this.props.status;
  }
  get issuedAt(): Date {
    return this.props.issuedAt;
  }
  get usedAt(): Date | null {
    return this.props.usedAt;
  }
  get usedBy(): string | null {
    return this.props.usedBy;
  }
  get voidedAt(): Date | null {
    return this.props.voidedAt;
  }

  snapshot(): TicketProps {
    return { ...this.props, staffUserIds: [...this.props.staffUserIds] };
  }

  /** True when the event has a known organizer list to authorize against. */
  hasOrganizerData(): boolean {
    return this.props.organizerId !== null || this.props.staffUserIds.length > 0;
  }

  isManagedBy(userId: string): boolean {
    return this.props.organizerId === userId || this.props.staffUserIds.includes(userId);
  }

  /** Guards the final states (invariant 5): USED and VOIDED never change again. */
  assertCanBeUsed(): void {
    if (this.props.status === TicketStatus.USED) throw new TicketAlreadyUsedError(this.props.id, this.props.usedAt);
    if (this.props.status === TicketStatus.VOIDED) throw new TicketVoidedError(this.props.id);
  }

  markUsed(by: string, at: Date): Ticket {
    this.assertCanBeUsed();
    return new Ticket({ ...this.props, status: TicketStatus.USED, usedAt: at, usedBy: by });
  }

  void(at: Date): Ticket {
    if (this.props.status === TicketStatus.USED) throw new TicketAlreadyUsedError(this.props.id, this.props.usedAt);
    if (this.props.status === TicketStatus.VOIDED) return this;
    return new Ticket({ ...this.props, status: TicketStatus.VOIDED, voidedAt: at });
  }
}
