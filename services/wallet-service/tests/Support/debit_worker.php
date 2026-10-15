<?php

// Child process used by ConcurrencyTest: runs one use case against the real database.
// Usage: php debit_worker.php debit <userId> <registrationId> <amount>
//        php debit_worker.php topup <userId> <topUpId> <gatewayRef>

use Bandada\Wallet\Application\Port\In\DebitCreditsCommand;
use Bandada\Wallet\Application\Port\In\DebitCreditsUseCase;
use Bandada\Wallet\Application\Port\In\HandlePaymentWebhookUseCase;
use Bandada\Wallet\Application\Port\In\PaymentNotification;
use Bandada\Wallet\Domain\Event\EventContext;
use Illuminate\Contracts\Console\Kernel;
use Ramsey\Uuid\Uuid;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[, $mode, $userId, $ref, $extra] = $argv;
$messageId = Uuid::uuid7()->toString();   // every worker is a distinct broker message

if ($mode === 'debit') {
    $result = $app->make(DebitCreditsUseCase::class)->handle(new DebitCreditsCommand(
        $messageId, '0192a3be-5a6a-7000-8000-000000000001', $ref, '0192a3be-5a6a-7000-8000-000000000001:DEBIT_CREDITS',
        $userId, '0192a3be-1234-7abc-8def-000000000042', (int) $extra, null, EventContext::none(),
    ));
    echo $result->outcome.':'.($result->reason ?? '');
} else {
    $result = $app->make(HandlePaymentWebhookUseCase::class)->handle(
        new PaymentNotification('evt', $extra, $ref, 'PAID', 5000, 'BOB', new DateTimeImmutable),
        EventContext::none(),
    );
    echo $result->duplicate ? 'DUPLICATE' : 'CREDITED';
}
