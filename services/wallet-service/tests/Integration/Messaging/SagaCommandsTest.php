<?php

use Illuminate\Support\Facades\DB;
use Tests\Support\RabbitHarness;

const U = '0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
const SAGA = '0192a3be-5a6a-7000-8000-000000000001';
const REG = '0192a3bf-aaaa-7bbb-8ccc-000000000777';

function debitData(int $amount = 50, string $registration = REG): array
{
    return [
        'sagaId' => SAGA, 'registrationId' => $registration, 'idempotencyKey' => SAGA.':DEBIT_CREDITS', 'userId' => U,
        'eventId' => '0192a3be-1234-7abc-8def-000000000042', 'amountCredits' => $amount,
        'description' => 'Inscripción a «Taller de Docker para principiantes»', 'deadlineAt' => gmdate('Y-m-d\TH:i:s\Z', time() + 30),
    ];
}

function refundData(int $amount = 50, string $registration = REG): array
{
    return [
        'sagaId' => SAGA, 'registrationId' => $registration, 'idempotencyKey' => SAGA.':REFUND_CREDITS', 'userId' => U,
        'amountCredits' => $amount, 'reason' => 'SAGA_COMPENSATION', 'deadlineAt' => gmdate('Y-m-d\TH:i:s\Z', time() + 30),
    ];
}

beforeEach(function () {
    $this->mq = new RabbitHarness($this->app);
    DB::table('wallets')->insert(['user_id' => U, 'balance_credits' => 100]);
});

it('debits through the real broker and answers credits-debited with the CloudEvents extensions', function () {
    $commandId = $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData(), extensions: ['correlationid' => 'c-7f3a']);

    $this->mq->consume(1);
    expect($this->mq->relay())->toBe(1);
    $events = $this->mq->publishedEvents();

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and(DB::table('ledger_entries')->where('operation_ref', 'DEBIT:'.REG)->value('description'))->toStartWith('Inscripción a')
        ->and($events)->toHaveCount(1);
    $event = $events[0]['event'];
    $message = $events[0]['message'];
    expect($event['type'])->toBe('bandada.wallet.credits-debited.v1')
        ->and($event['source'])->toBe('/services/wallet-service')
        ->and($event['specversion'])->toBe('1.0')
        ->and($event['sagaid'])->toBe(SAGA)
        ->and($event['correlationid'])->toBe('c-7f3a')
        ->and($event['causationid'])->toBe($commandId)
        ->and($event['subject'])->toBe('registration/'.REG)
        ->and($event['traceparent'])->toMatch('/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/')
        ->and($event['traceparent'])->not->toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
        ->and($event['data'])->toMatchArray([
            'sagaId' => SAGA, 'registrationId' => REG, 'userId' => U, 'amountCredits' => 50, 'balanceCredits' => 50,
            'idempotencyKey' => SAGA.':DEBIT_CREDITS',
        ])
        ->and($event['data']['ledgerEntryId'])->toBeString()
        ->and($message->get('message_id'))->toBe($event['id'])
        ->and($message->get('type'))->toBe('bandada.wallet.credits-debited.v1')
        ->and($message->get('content_type'))->toBe('application/cloudevents+json')
        ->and($message->get('delivery_mode'))->toBe(2)
        ->and($message->get('correlation_id'))->toBe('c-7f3a')
        ->and($message->get('application_headers')->getNativeData()['traceparent'])->toBe($event['traceparent']);
    expect(DB::table('outbox')->whereNull('published_at')->count())->toBe(0);
});

it('answers credits-debit-failed INSUFFICIENT_FUNDS without moving money', function () {
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData(500));

    $this->mq->consume(1);
    $this->mq->relay();
    $event = $this->mq->publishedEvents()[0]['event'];

    expect($event['type'])->toBe('bandada.wallet.credits-debit-failed.v1')
        ->and($event['data'])->toMatchArray(['reason' => 'INSUFFICIENT_FUNDS', 'requiredCredits' => 500, 'balanceCredits' => 100, 'registrationId' => REG])
        ->and((int) DB::table('wallets')->value('balance_credits'))->toBe(100);
});

it('answers WALLET_NOT_FOUND for a user without a wallet', function () {
    DB::table('wallets')->delete();
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());

    $this->mq->consume(1);
    $this->mq->relay();
    $event = $this->mq->publishedEvents()[0]['event'];

    expect($event['data']['reason'])->toBe('WALLET_NOT_FOUND')->and($event['data']['balanceCredits'])->toBeNull();
});

it('processes a duplicated message (same CloudEvent id) once', function () {
    $id = $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData(), id: $id);

    $this->mq->consume(2);
    $this->mq->relay();

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and(DB::table('processed_messages')->count())->toBe(1)
        ->and($this->mq->publishedEvents())->toHaveCount(1);
});

it('re-publishes the original answer when the orchestrator resends the command with a new id', function () {
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());

    $this->mq->consume(2);
    $this->mq->relay();
    $events = $this->mq->publishedEvents();

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and($events)->toHaveCount(2)
        ->and($events[0]['event']['type'])->toBe('bandada.wallet.credits-debited.v1')
        ->and($events[1]['event']['type'])->toBe('bandada.wallet.credits-debited.v1')
        ->and($events[1]['event']['data']['ledgerEntryId'])->toBe($events[0]['event']['data']['ledgerEntryId'])
        ->and($events[1]['event']['id'])->not->toBe($events[0]['event']['id']);
});

it('refunds the debited amount, idempotently', function () {
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData(30));
    $this->mq->command('bandada.wallet.cmd.refund-credits.v1', refundData());
    $this->mq->command('bandada.wallet.cmd.refund-credits.v1', refundData());

    $this->mq->consume(3);
    $this->mq->relay();
    $events = $this->mq->publishedEvents();

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(100)
        ->and(DB::table('ledger_entries')->where('type', 'REFUND')->count())->toBe(1)
        ->and(array_column(array_column($events, 'event'), 'type'))->toBe([
            'bandada.wallet.credits-debited.v1', 'bandada.wallet.credits-refunded.v1', 'bandada.wallet.credits-refunded.v1',
        ])
        ->and($events[1]['event']['data']['amountCredits'])->toBe(30)
        ->and($events[2]['event']['data']['amountCredits'])->toBe(30);
});

it('records a tombstone for a refund without debit and rejects the late debit (SAGA_ABORTED)', function () {
    $this->mq->command('bandada.wallet.cmd.refund-credits.v1', refundData());
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());

    $this->mq->consume(2);
    $this->mq->relay();
    $events = $this->mq->publishedEvents();

    expect($events[0]['event']['type'])->toBe('bandada.wallet.credits-refunded.v1')
        ->and($events[0]['event']['data'])->toMatchArray(['amountCredits' => 0, 'ledgerEntryId' => null, 'balanceCredits' => 100])
        ->and($events[1]['event']['type'])->toBe('bandada.wallet.credits-debit-failed.v1')
        ->and($events[1]['event']['data']['reason'])->toBe('SAGA_ABORTED')
        ->and((int) DB::table('wallets')->value('balance_credits'))->toBe(100)
        ->and(DB::table('ledger_entries')->where('operation_ref', 'REFUND:'.REG)->value('amount_credits'))->toBe(0);
});

it('sends malformed and unknown messages straight to the DLQ without stopping the consumer', function () {
    $this->mq->publishRaw('{not json', 'bandada.wallet.cmd.debit-credits.v1');
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', ['registrationId' => REG]);                       // missing fields
    $this->mq->command('bandada.wallet.cmd.freeze-wallet.v1', debitData());                                      // unknown type
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData(10, '0192a3bf-aaaa-7bbb-8ccc-000000000888')); // healthy one behind them

    $this->mq->consume(4);
    $this->mq->relay();
    usleep(500_000);

    expect($this->mq->depth('wallet-service.commands.dlq'))->toBe(3)
        ->and((int) DB::table('wallets')->value('balance_credits'))->toBe(90)
        ->and($this->mq->publishedEvents())->toHaveCount(1);
});

it('parks a transiently failing message in a wait queue and processes it after the retry delay', function () {
    $this->mq->command('bandada.wallet.cmd.debit-credits.v1', debitData());
    DB::statement('ALTER TABLE processed_messages RENAME TO processed_messages_off');   // the database "breaks"

    try {
        $this->mq->consume(1);
    } finally {
        DB::statement('ALTER TABLE processed_messages_off RENAME TO processed_messages');
    }

    usleep(300_000);
    expect($this->mq->depth('wallet-service.commands.retry.5s'))->toBe(1)
        ->and($this->mq->depth('wallet-service.commands'))->toBe(0)
        ->and((int) DB::table('wallets')->value('balance_credits'))->toBe(100);

    sleep(6);                                                       // retry.5s expires and dead-letters back to the main queue
    $this->mq->consume(1, 6);
    $this->mq->relay();

    expect((int) DB::table('wallets')->value('balance_credits'))->toBe(50)
        ->and($this->mq->publishedEvents())->toHaveCount(1)
        ->and($this->mq->depth('wallet-service.commands.dlq'))->toBe(0);
});
