package com.bandadau.events.domain.saga;

import com.bandadau.events.domain.registration.FailureReason;
import com.bandadau.events.domain.registration.RegistrationId;
import com.bandadau.events.domain.shared.AggregateRoot;
import com.bandadau.events.domain.shared.Errors;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Process manager state (saga-inscripcion-evento.md section 4). All transitions are pure: they mutate this aggregate
 * and return a {@link SagaDecision}; the orchestrator persists and emits.
 *
 * <p>Forward steps wait 30 s with three business resends; compensations are resent without limit (D15) and raise
 * an alert after two minutes. Ante la duda, compensar: a timeout does not tell whether the participant executed the
 * step, so its compensation is sent anyway and the participants answer idempotently (tombstones).
 */
public final class SagaInstance extends AggregateRoot<SagaId> {
    public record Transition(Instant at, SagaStatus from, SagaStatus to, SagaStep step, UUID messageId) { }

    private static final int HISTORY_LIMIT = 60;

    private final SagaId id;
    private final RegistrationId registrationId;
    private final SagaType type;
    private SagaStatus status;
    private SagaStep step;
    private int attempt;
    private Instant deadlineAt;
    private Instant nextRetryAt;
    private SagaContext context;
    private FailureReason failureReason;
    private final List<Transition> history;
    private final long version;
    private final Instant startedAt;
    private Instant updatedAt;
    private Instant finishedAt;

    private SagaInstance(SagaId id, RegistrationId registrationId, SagaType type, SagaStatus status, SagaStep step,
                         int attempt, Instant deadlineAt, Instant nextRetryAt, SagaContext context,
                         FailureReason failureReason, List<Transition> history, long version, Instant startedAt,
                         Instant updatedAt, Instant finishedAt) {
        this.id = id;
        this.registrationId = registrationId;
        this.type = type;
        this.status = status;
        this.step = step;
        this.attempt = attempt;
        this.deadlineAt = deadlineAt;
        this.nextRetryAt = nextRetryAt;
        this.context = context;
        this.failureReason = failureReason;
        this.history = new ArrayList<>(history);
        this.version = version;
        this.startedAt = startedAt;
        this.updatedAt = updatedAt;
        this.finishedAt = finishedAt;
    }

    public static SagaInstance create(SagaId id, RegistrationId registrationId, SagaType type, SagaContext context,
                                      Instant now) {
        return new SagaInstance(id, registrationId, type, SagaStatus.STARTED, SagaStep.RESERVE_SEAT, 0, null, null,
                context, null, List.of(), 0, now, now, null);
    }

    public static SagaInstance restore(SagaId id, RegistrationId registrationId, SagaType type, SagaStatus status,
                                       SagaStep step, int attempt, Instant deadlineAt, Instant nextRetryAt,
                                       SagaContext context, FailureReason failureReason, List<Transition> history,
                                       long version, Instant startedAt, Instant updatedAt, Instant finishedAt) {
        return new SagaInstance(id, registrationId, type, status, step, attempt, deadlineAt, nextRetryAt, context,
                failureReason, history, version, startedAt, updatedAt, finishedAt);
    }

    // ---- start -------------------------------------------------------------------------------------------------

    /** Step 1 already happened locally (seat reserved); decide the first remote command. */
    public SagaDecision start(SagaPolicy policy, Instant now) {
        if (status != SagaStatus.STARTED) throw new IllegalStateException("Saga already started");
        if (type == SagaType.CANCELLATION) {
            return enterCompensation(SagaStep.VOID_TICKET, policy, now, null);
        }
        return context.free() ? enterForward(SagaStatus.AWAITING_TICKET, SagaStep.ISSUE_TICKET, policy, now, null)
                : enterForward(SagaStatus.AWAITING_DEBIT, SagaStep.DEBIT_CREDITS, policy, now, null);
    }

    // ---- replies -----------------------------------------------------------------------------------------------

    public SagaDecision onReply(SagaReply reply, UUID messageId, SagaPolicy policy, Instant now) {
        if (status.isTerminal()) return lateReply(reply);
        return switch (status) {
            case AWAITING_DEBIT -> onDebitStep(reply, messageId, policy, now);
            case AWAITING_TICKET -> onTicketStep(reply, messageId, policy, now);
            case COMPENSATING -> onCompensationStep(reply, messageId, policy, now);
            default -> SagaDecision.ignore();
        };
    }

    private SagaDecision onDebitStep(SagaReply reply, UUID messageId, SagaPolicy policy, Instant now) {
        return switch (reply) {
            case SagaReply.CreditsDebited r -> {
                context = context.debited(r.ledgerEntryId());
                yield enterForward(SagaStatus.AWAITING_TICKET, SagaStep.ISSUE_TICKET, policy, now, messageId);
            }
            case SagaReply.CreditsDebitFailed r -> finishCompensated(FailureReason.fromWallet(r.reason()), now, messageId);
            default -> SagaDecision.ignore();
        };
    }

    private SagaDecision onTicketStep(SagaReply reply, UUID messageId, SagaPolicy policy, Instant now) {
        return switch (reply) {
            case SagaReply.TicketIssued r -> {
                context = context.withTicket(r.ticketId());
                transition(SagaStatus.COMPLETED, SagaStep.ISSUE_TICKET, now, messageId);
                clearTimers();
                finishedAt = now;
                yield SagaDecision.confirm(r.ticketId());
            }
            case SagaReply.TicketIssueFailed r -> {
                if ("ALREADY_VOIDED".equals(r.reason())) yield SagaDecision.ignore();
                failureReason = FailureReason.TICKET_ISSUE_FAILED;
                // The ticket definitively does not exist: only the debit (if any) has to be undone.
                yield context.free() || !context.debited()
                        ? finishCompensated(FailureReason.TICKET_ISSUE_FAILED, now, messageId)
                        : enterCompensation(SagaStep.REFUND_CREDITS, policy, now, messageId);
            }
            default -> SagaDecision.ignore();
        };
    }

    private SagaDecision onCompensationStep(SagaReply reply, UUID messageId, SagaPolicy policy, Instant now) {
        return switch (reply) {
            case SagaReply.TicketVoided r when step == SagaStep.VOID_TICKET -> {
                if (r.ticketId() != null) context = context.withTicket(r.ticketId());
                yield context.free() ? finishAfterCompensation(now, messageId)
                        : enterCompensation(SagaStep.REFUND_CREDITS, policy, now, messageId);
            }
            case SagaReply.TicketVoidFailed r when step == SagaStep.VOID_TICKET -> {
                // TICKET_ALREADY_USED: the ticket cannot be undone, so there is nothing left to compensate.
                transition(SagaStatus.FAILED, step, now, messageId);
                clearTimers();
                finishedAt = now;
                failureReason = FailureReason.SAGA_ABORTED;
                yield type == SagaType.CANCELLATION ? SagaDecision.rejected() : SagaDecision.fail(FailureReason.SAGA_ABORTED);
            }
            case SagaReply.CreditsRefunded r when step == SagaStep.REFUND_CREDITS -> {
                context = context.refunded(r.amountCredits());
                yield finishAfterCompensation(now, messageId);
            }
            default -> SagaDecision.ignore();
        };
    }

    /** T4: a debit confirmation that arrives after the saga ended must be refunded defensively (idempotent). */
    private SagaDecision lateReply(SagaReply reply) {
        if (type == SagaType.REGISTRATION && reply instanceof SagaReply.CreditsDebited && !context.free()
                && (status == SagaStatus.COMPENSATED || status == SagaStatus.FAILED)) {
            return SagaDecision.send(new SagaCommand.RefundCredits(context.priceCredits(), CompensationReason.SAGA_COMPENSATION));
        }
        return SagaDecision.ignore();
    }

    // ---- timeouts ----------------------------------------------------------------------------------------------

    public boolean isDue(Instant now) {
        if (status.isTerminal() || status == SagaStatus.STARTED) return false;
        return (deadlineAt != null && !now.isBefore(deadlineAt)) || (nextRetryAt != null && !now.isBefore(nextRetryAt));
    }

    public SagaDecision onTimeout(SagaPolicy policy, Instant now) {
        return switch (status) {
            case AWAITING_DEBIT -> forwardTimeout(policy, now, SagaStep.REFUND_CREDITS);
            case AWAITING_TICKET -> forwardTimeout(policy, now, SagaStep.VOID_TICKET);
            case COMPENSATING -> compensationTimeout(policy, now);
            default -> SagaDecision.none();
        };
    }

    private SagaDecision forwardTimeout(SagaPolicy policy, Instant now, SagaStep firstCompensation) {
        if (deadlineAt != null && !now.isBefore(deadlineAt)) {
            failureReason = FailureReason.TIMEOUT;
            return enterCompensation(firstCompensation, policy, now, null);
        }
        if (nextRetryAt != null && !now.isBefore(nextRetryAt) && attempt < policy.resendOffsets().size()) {
            attempt++;
            nextRetryAt = attempt < policy.resendOffsets().size()
                    ? context.stepStartedAt().plus(policy.resendOffsets().get(attempt)) : null;
            updatedAt = now;
            return SagaDecision.send(commandFor(step));
        }
        return SagaDecision.none();
    }

    private SagaDecision compensationTimeout(SagaPolicy policy, Instant now) {
        boolean alert = false;
        if (!context.alerted() && context.compensationStartedAt() != null
                && !now.isBefore(context.compensationStartedAt().plus(policy.alertAfter()))) {
            context = context.markAlerted();
            alert = true;
        }
        if (nextRetryAt == null || now.isBefore(nextRetryAt)) return alert ? SagaDecision.alertOnly() : SagaDecision.none();
        attempt++;
        nextRetryAt = now.plus(policy.compensationBackoff(attempt));
        deadlineAt = nextRetryAt;
        updatedAt = now;
        SagaDecision resend = SagaDecision.send(commandFor(step));
        return alert ? new SagaDecision(resend.commands(), resend.outcome(), false, true) : resend;
    }

    // ---- retrySaga (operator re-drive) --------------------------------------------------------------------------

    /** UC-13 10b: FAILED sagas resume from the step they stopped at; stuck COMPENSATING ones are resent right now. */
    public SagaDecision retry(SagaPolicy policy, Instant now) {
        switch (status) {
            case FAILED -> {
                SagaStep resumeAt = step == SagaStep.VOID_TICKET || step == SagaStep.REFUND_CREDITS ? step : SagaStep.VOID_TICKET;
                status = SagaStatus.COMPENSATING;
                failureReason = null;
                finishedAt = null;
                SagaDecision d = enterCompensation(resumeAt, policy, now, null);
                return type == SagaType.CANCELLATION ? SagaDecision.resumed(d.commands().get(0)) : d;
            }
            case COMPENSATING -> {
                context = context.stepStarted(now);
                attempt = 0;
                nextRetryAt = now.plus(policy.compensationBackoff(0));
                deadlineAt = nextRetryAt;
                updatedAt = now;
                return SagaDecision.send(commandFor(step));
            }
            case COMPLETED, COMPENSATED -> throw Errors.sagaNotRetryable(status.name());
            default -> {
                return SagaDecision.none();
            }
        }
    }

    // ---- internals ---------------------------------------------------------------------------------------------

    private SagaDecision enterForward(SagaStatus to, SagaStep newStep, SagaPolicy policy, Instant now, UUID messageId) {
        transition(to, newStep, now, messageId);
        attempt = 0;
        context = context.stepStarted(now);
        deadlineAt = now.plus(policy.stepTimeout());
        nextRetryAt = policy.resendOffsets().isEmpty() ? null : now.plus(policy.resendOffsets().get(0));
        return SagaDecision.send(commandFor(newStep));
    }

    private SagaDecision enterCompensation(SagaStep newStep, SagaPolicy policy, Instant now, UUID messageId) {
        transition(SagaStatus.COMPENSATING, newStep, now, messageId);
        attempt = 0;
        context = context.stepStarted(now).compensationStarted(now);
        nextRetryAt = now.plus(policy.compensationBackoff(0));
        deadlineAt = nextRetryAt;
        return SagaDecision.send(commandFor(newStep));
    }

    private SagaDecision finishAfterCompensation(Instant now, UUID messageId) {
        if (type == SagaType.CANCELLATION) {
            transition(SagaStatus.COMPLETED, SagaStep.RELEASE_SEAT, now, messageId);
            clearTimers();
            finishedAt = now;
            return SagaDecision.cancelled(context.refundedCredits());
        }
        return finishCompensated(failureReason == null ? FailureReason.SAGA_ABORTED : failureReason, now, messageId);
    }

    private SagaDecision finishCompensated(FailureReason reason, Instant now, UUID messageId) {
        failureReason = reason;
        transition(SagaStatus.COMPENSATED, SagaStep.RELEASE_SEAT, now, messageId);
        clearTimers();
        finishedAt = now;
        return SagaDecision.fail(reason);
    }

    private void clearTimers() {
        deadlineAt = null;
        nextRetryAt = null;
    }

    private void transition(SagaStatus to, SagaStep newStep, Instant now, UUID messageId) {
        history.add(new Transition(now, status, to, newStep, messageId));
        if (history.size() > HISTORY_LIMIT) history.remove(0);
        status = to;
        step = newStep;
        updatedAt = now;
    }

    private SagaCommand commandFor(SagaStep forStep) {
        return switch (forStep) {
            case DEBIT_CREDITS -> new SagaCommand.DebitCredits(context.priceCredits());
            case ISSUE_TICKET -> new SagaCommand.IssueTicket();
            case VOID_TICKET -> new SagaCommand.VoidTicket(context.ticketId(), reason());
            case REFUND_CREDITS -> new SagaCommand.RefundCredits(context.priceCredits(), reason());
            default -> throw new IllegalStateException("No command for step " + forStep);
        };
    }

    private CompensationReason reason() {
        return type == SagaType.CANCELLATION && context.cancelReason() != null ? context.cancelReason()
                : CompensationReason.SAGA_COMPENSATION;
    }

    /** idempotencyKey of the command of {@code forStep}: {@code <sagaId>:<step>} (D2). */
    public String idempotencyKey(SagaStep forStep) { return id.value() + ":" + forStep.name(); }

    @Override public SagaId id() { return id; }
    public RegistrationId registrationId() { return registrationId; }
    public SagaType type() { return type; }
    public SagaStatus status() { return status; }
    public SagaStep step() { return step; }
    public int attempt() { return attempt; }
    public Instant deadlineAt() { return deadlineAt; }
    public Instant nextRetryAt() { return nextRetryAt; }
    public SagaContext context() { return context; }
    public FailureReason failureReason() { return failureReason; }
    public List<Transition> history() { return List.copyOf(history); }
    public long version() { return version; }
    public Instant startedAt() { return startedAt; }
    public Instant updatedAt() { return updatedAt; }
    public Instant finishedAt() { return finishedAt; }
}
