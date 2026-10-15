package com.bandadau.events.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bandadau.events.domain.registration.FailureReason;
import com.bandadau.events.domain.registration.RegistrationId;
import com.bandadau.events.domain.saga.*;
import com.bandadau.events.domain.saga.SagaDecision.OutcomeType;
import com.bandadau.events.domain.shared.DomainException;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Transition table of the saga (state x reply -> decision), pure and without infrastructure (testing-strategy section 6). */
class SagaInstanceTest {
    static final Instant T0 = Instant.parse("2026-10-14T12:00:00Z");
    static final SagaPolicy POLICY = SagaPolicy.defaults();
    final UUID ticket = UUID.randomUUID();

    SagaInstance saga(SagaType type, long price, CompensationReason cancelReason, UUID ticketId) {
        return SagaInstance.create(new SagaId(UUID.randomUUID()), new RegistrationId(UUID.randomUUID()), type,
                SagaContext.initial(UUID.randomUUID(), UUID.randomUUID(), price, "Taller", "Aula", T0.plusSeconds(86400 * 3),
                        "corr-1", ticketId, cancelReason), T0);
    }

    SagaInstance registration(long price) { return saga(SagaType.REGISTRATION, price, null, null); }

    static Instant at(long seconds) { return T0.plusSeconds(seconds); }

    static <T extends SagaCommand> T single(SagaDecision d, Class<T> type) {
        assertThat(d.commands()).hasSize(1);
        return type.cast(d.commands().get(0));
    }

    // ---- S1, S2: happy paths --------------------------------------------------------------------

    @Test
    void paidRegistrationDebitsThenIssuesTheTicketAndCompletes() {
        SagaInstance s = registration(20);
        assertThat(single(s.start(POLICY, T0), SagaCommand.DebitCredits.class).amountCredits()).isEqualTo(20);
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_DEBIT);
        assertThat(s.deadlineAt()).isEqualTo(at(30));

        SagaDecision afterDebit = s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(1));
        single(afterDebit, SagaCommand.IssueTicket.class);
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_TICKET);
        assertThat(s.context().debited()).isTrue();

        SagaDecision done = s.onReply(new SagaReply.TicketIssued(ticket), UUID.randomUUID(), POLICY, at(2));
        assertThat(done.outcome().type()).isEqualTo(OutcomeType.CONFIRM);
        assertThat(done.outcome().ticketId()).isEqualTo(ticket);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPLETED);
        assertThat(s.deadlineAt()).isNull();
        assertThat(s.isDue(at(1000))).isFalse();
    }

    @Test
    void freeRegistrationSkipsTheDebit() {
        SagaInstance s = registration(0);
        single(s.start(POLICY, T0), SagaCommand.IssueTicket.class);
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_TICKET);
        assertThat(s.onReply(new SagaReply.TicketIssued(ticket), UUID.randomUUID(), POLICY, at(1)).outcome().type())
                .isEqualTo(OutcomeType.CONFIRM);
    }

    @Test
    void idempotencyKeyIsSagaIdColonStep() {
        SagaInstance s = registration(20);
        assertThat(s.idempotencyKey(SagaStep.DEBIT_CREDITS)).isEqualTo(s.id().value() + ":DEBIT_CREDITS");
    }

    // ---- S3: insufficient funds -----------------------------------------------------------------

    @Test
    void debitFailureCompensatesLocallyWithTheWalletReason() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        SagaDecision d = s.onReply(new SagaReply.CreditsDebitFailed("INSUFFICIENT_FUNDS"), UUID.randomUUID(), POLICY, at(1));
        assertThat(d.commands()).isEmpty();
        assertThat(d.outcome().type()).isEqualTo(OutcomeType.FAIL);
        assertThat(d.outcome().reason()).isEqualTo(FailureReason.INSUFFICIENT_FUNDS);
        assertThat(d.releasesSeat()).isTrue();
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);
        assertThat(s.step()).isEqualTo(SagaStep.RELEASE_SEAT);
    }

    @Test
    void lateDebitAbortAndUnknownWalletReasonsMapToStableCodes() {
        assertThat(FailureReason.fromWallet("WALLET_NOT_FOUND")).isEqualTo(FailureReason.WALLET_NOT_FOUND);
        assertThat(FailureReason.fromWallet("SAGA_ABORTED")).isEqualTo(FailureReason.SAGA_ABORTED);
        assertThat(FailureReason.fromWallet("SOMETHING_NEW")).isEqualTo(FailureReason.SAGA_ABORTED);
    }

    // ---- S4: ticketing failure -> refund -> release ---------------------------------------------

    @Test
    void ticketFailureAfterDebitRefundsThenReleasesTheSeat() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(1));
        SagaDecision d = s.onReply(new SagaReply.TicketIssueFailed("CHAOS_INJECTED"), UUID.randomUUID(), POLICY, at(2));
        SagaCommand.RefundCredits refund = single(d, SagaCommand.RefundCredits.class);
        assertThat(refund.amountCredits()).isEqualTo(20);
        assertThat(refund.reason()).isEqualTo(CompensationReason.SAGA_COMPENSATION);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);
        assertThat(s.step()).isEqualTo(SagaStep.REFUND_CREDITS);

        SagaDecision end = s.onReply(new SagaReply.CreditsRefunded(20), UUID.randomUUID(), POLICY, at(3));
        assertThat(end.outcome().type()).isEqualTo(OutcomeType.FAIL);
        assertThat(end.outcome().reason()).isEqualTo(FailureReason.TICKET_ISSUE_FAILED);
        assertThat(end.releasesSeat()).isTrue();
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);
    }

    @Test
    void ticketFailureOnAFreeEventOnlyReleasesTheSeat() {
        SagaInstance s = registration(0);
        s.start(POLICY, T0);
        SagaDecision d = s.onReply(new SagaReply.TicketIssueFailed("STORAGE_ERROR"), UUID.randomUUID(), POLICY, at(1));
        assertThat(d.commands()).isEmpty();
        assertThat(d.outcome().reason()).isEqualTo(FailureReason.TICKET_ISSUE_FAILED);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);
    }

    // ---- S5: timeouts, resends, compensation order ------------------------------------------------

    @Test
    void debitTimeoutResendsAtFixedOffsetsThenRefundsBecauseTheOutcomeIsUnknown() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        assertThat(s.isDue(at(4))).isFalse();
        assertThat(s.isDue(at(5))).isTrue();

        SagaDecision r1 = s.onTimeout(POLICY, at(5));
        assertThat(single(r1, SagaCommand.DebitCredits.class).step()).isEqualTo(SagaStep.DEBIT_CREDITS);
        assertThat(s.attempt()).isEqualTo(1);
        assertThat(s.nextRetryAt()).isEqualTo(at(10));
        s.onTimeout(POLICY, at(10));
        s.onTimeout(POLICY, at(20));
        assertThat(s.attempt()).isEqualTo(3);
        assertThat(s.nextRetryAt()).isNull();
        assertThat(s.onTimeout(POLICY, at(25)).commands()).isEmpty();

        SagaDecision timeout = s.onTimeout(POLICY, at(30));
        SagaCommand.RefundCredits refund = single(timeout, SagaCommand.RefundCredits.class);
        assertThat(refund.amountCredits()).isEqualTo(20);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);
        assertThat(s.failureReason()).isEqualTo(FailureReason.TIMEOUT);

        SagaDecision end = s.onReply(new SagaReply.CreditsRefunded(0), UUID.randomUUID(), POLICY, at(31));
        assertThat(end.outcome().reason()).isEqualTo(FailureReason.TIMEOUT);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);
    }

    @Test
    void ticketTimeoutVoidsThenRefundsThenReleases() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(1));
        s.onTimeout(POLICY, at(31));
        assertThat(s.step()).isEqualTo(SagaStep.VOID_TICKET);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);

        SagaDecision afterVoid = s.onReply(new SagaReply.TicketVoided(null), UUID.randomUUID(), POLICY, at(32));
        single(afterVoid, SagaCommand.RefundCredits.class);
        SagaDecision end = s.onReply(new SagaReply.CreditsRefunded(20), UUID.randomUUID(), POLICY, at(33));
        assertThat(end.outcome().type()).isEqualTo(OutcomeType.FAIL);
        assertThat(end.outcome().reason()).isEqualTo(FailureReason.TIMEOUT);
    }

    @Test
    void compensationsAreResentWithoutLimitWithBackoffAndAlertOnce() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onTimeout(POLICY, at(30));           // -> COMPENSATING / REFUND_CREDITS, first command sent
        long now = 30;
        long[] expectedGaps = {5, 10, 20, 40, 60, 60, 60};
        int alerts = 0;
        for (long gap : expectedGaps) {
            SagaDecision probe = s.onTimeout(POLICY, at(now + gap - 1));
            assertThat(probe.commands()).isEmpty();
            if (probe.alert()) alerts++;
            now += gap;
            SagaDecision d = s.onTimeout(POLICY, at(now));
            single(d, SagaCommand.RefundCredits.class);
            if (d.alert()) alerts++;
        }
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);
        assertThat(alerts).isEqualTo(1);                     // after 2 minutes, only once
        assertThat(s.attempt()).isEqualTo(expectedGaps.length);
    }

    // ---- S6: duplicates and late replies ---------------------------------------------------------

    @Test
    void duplicatedDebitReplyDoesNotIssueASecondTicket() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(1));
        SagaDecision dup = s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(2));
        assertThat(dup.ignored()).isTrue();
        assertThat(dup.commands()).isEmpty();
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_TICKET);
    }

    @Test
    void repliesOfAnotherStepAreIgnored() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        assertThat(s.onReply(new SagaReply.TicketIssued(ticket), UUID.randomUUID(), POLICY, at(1)).ignored()).isTrue();
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_DEBIT);
    }

    @Test
    void lateDebitAfterCompensationIsRefundedDefensivelyAndTheSagaStaysTerminal() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onTimeout(POLICY, at(30));
        s.onReply(new SagaReply.CreditsRefunded(0), UUID.randomUUID(), POLICY, at(31));
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);

        SagaDecision late = s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(40));
        assertThat(single(late, SagaCommand.RefundCredits.class).amountCredits()).isEqualTo(20);
        assertThat(late.outcome().type()).isEqualTo(OutcomeType.NONE);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATED);

        assertThat(s.onReply(new SagaReply.TicketIssued(ticket), UUID.randomUUID(), POLICY, at(41)).ignored()).isTrue();
    }

    @Test
    void ticketIssueFailedAlreadyVoidedIsIgnored() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), UUID.randomUUID(), POLICY, at(1));
        assertThat(s.onReply(new SagaReply.TicketIssueFailed("ALREADY_VOIDED"), UUID.randomUUID(), POLICY, at(2)).ignored()).isTrue();
        assertThat(s.status()).isEqualTo(SagaStatus.AWAITING_TICKET);
    }

    // ---- S9: cancellation (UC-13) ------------------------------------------------------------------

    @Test
    void cancellationVoidsRefundsAndCompletes() {
        SagaInstance s = saga(SagaType.CANCELLATION, 20, CompensationReason.USER_CANCELLATION, ticket);
        SagaCommand.VoidTicket cmd = single(s.start(POLICY, T0), SagaCommand.VoidTicket.class);
        assertThat(cmd.ticketId()).isEqualTo(ticket);
        assertThat(cmd.reason()).isEqualTo(CompensationReason.USER_CANCELLATION);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);

        SagaCommand.RefundCredits refund = single(s.onReply(new SagaReply.TicketVoided(ticket), UUID.randomUUID(), POLICY, at(1)),
                SagaCommand.RefundCredits.class);
        assertThat(refund.amountCredits()).isEqualTo(20);
        SagaDecision end = s.onReply(new SagaReply.CreditsRefunded(20), UUID.randomUUID(), POLICY, at(2));
        assertThat(end.outcome().type()).isEqualTo(OutcomeType.CANCELLED);
        assertThat(end.outcome().refundedCredits()).isEqualTo(20);
        assertThat(end.releasesSeat()).isTrue();
        assertThat(s.status()).isEqualTo(SagaStatus.COMPLETED);
    }

    @Test
    void cancellationOfAFreeEventSkipsTheRefund() {
        SagaInstance s = saga(SagaType.CANCELLATION, 0, CompensationReason.EVENT_CANCELLED, ticket);
        s.start(POLICY, T0);
        SagaDecision end = s.onReply(new SagaReply.TicketVoided(ticket), UUID.randomUUID(), POLICY, at(1));
        assertThat(end.outcome().type()).isEqualTo(OutcomeType.CANCELLED);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPLETED);
    }

    @Test
    void usedTicketRejectsTheCancellationAndCanBeRetried() {
        SagaInstance s = saga(SagaType.CANCELLATION, 20, CompensationReason.USER_CANCELLATION, ticket);
        s.start(POLICY, T0);
        SagaDecision d = s.onReply(new SagaReply.TicketVoidFailed("TICKET_ALREADY_USED"), UUID.randomUUID(), POLICY, at(1));
        assertThat(d.outcome().type()).isEqualTo(OutcomeType.CANCELLATION_REJECTED);
        assertThat(d.releasesSeat()).isFalse();
        assertThat(s.status()).isEqualTo(SagaStatus.FAILED);

        SagaDecision retry = s.retry(POLICY, at(100));
        assertThat(retry.outcome().type()).isEqualTo(OutcomeType.CANCELLATION_RESUMED);
        single(retry, SagaCommand.VoidTicket.class);
        assertThat(s.status()).isEqualTo(SagaStatus.COMPENSATING);
    }

    // ---- retrySaga ----------------------------------------------------------------------------------

    @Test
    void retryResendsStuckCompensationsAndRejectsFinishedSagas() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        s.onTimeout(POLICY, at(30));
        SagaDecision d = s.retry(POLICY, at(500));
        single(d, SagaCommand.RefundCredits.class);
        assertThat(s.attempt()).isZero();

        s.onReply(new SagaReply.CreditsRefunded(20), UUID.randomUUID(), POLICY, at(501));
        assertThatThrownBy(() -> s.retry(POLICY, at(502))).isInstanceOfSatisfying(DomainException.class,
                e -> assertThat(e.code()).isEqualTo("SAGA_NOT_RETRYABLE"));
    }

    @Test
    void historyRecordsTransitionsWithTheTriggeringMessage() {
        SagaInstance s = registration(20);
        s.start(POLICY, T0);
        UUID message = UUID.randomUUID();
        s.onReply(new SagaReply.CreditsDebited(UUID.randomUUID()), message, POLICY, at(1));
        assertThat(s.history()).extracting(SagaInstance.Transition::to).containsExactly(SagaStatus.AWAITING_DEBIT, SagaStatus.AWAITING_TICKET);
        assertThat(s.history().get(1).messageId()).isEqualTo(message);
        assertThat(Duration.between(s.startedAt(), s.updatedAt())).isEqualTo(Duration.ofSeconds(1));
    }
}
