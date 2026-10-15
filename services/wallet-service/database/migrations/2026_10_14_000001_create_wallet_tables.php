<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE wallets (
    user_id          UUID PRIMARY KEY,
    balance_credits  BIGINT      NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
    version          BIGINT      NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY,
    wallet_user_id  UUID         NOT NULL REFERENCES wallets (user_id),
    type            VARCHAR(8)   NOT NULL CHECK (type IN ('TOPUP', 'DEBIT', 'REFUND')),
    amount_credits  BIGINT       NOT NULL,
    balance_after   BIGINT       NOT NULL CHECK (balance_after >= 0),
    operation_ref   VARCHAR(64)  NOT NULL,
    saga_id         UUID,
    registration_id UUID,
    event_id        UUID,
    top_up_id       UUID,
    description     VARCHAR(200),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- A zero-amount REFUND is the tombstone for a refund that arrived without a prior debit.
    CONSTRAINT ledger_amount_by_type CHECK (
        (type = 'REFUND' AND amount_credits >= 0) OR (type <> 'REFUND' AND amount_credits > 0)
    )
);
CREATE UNIQUE INDEX ux_ledger_operation_ref ON ledger_entries (operation_ref);
CREATE INDEX idx_ledger_wallet_created ON ledger_entries (wallet_user_id, created_at DESC, id DESC);
CREATE INDEX idx_ledger_created ON ledger_entries (created_at);

CREATE TABLE top_ups (
    id               UUID PRIMARY KEY,
    user_id          UUID         NOT NULL,
    package          VARCHAR(16)  NOT NULL,
    amount_credits   BIGINT       NOT NULL CHECK (amount_credits > 0),
    price_minor      BIGINT       NOT NULL CHECK (price_minor > 0),
    currency         VARCHAR(3)   NOT NULL,
    status           VARCHAR(8)   NOT NULL CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED')),
    gateway_ref      VARCHAR(80),
    idempotency_key  UUID,
    expires_at       TIMESTAMPTZ  NOT NULL,
    paid_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_topups_gateway_ref ON top_ups (gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE UNIQUE INDEX ux_topups_user_idempotency ON top_ups (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_topups_user ON top_ups (user_id, created_at DESC);
CREATE INDEX idx_topups_pending_expiry ON top_ups (expires_at) WHERE status = 'PENDING';

CREATE TABLE outbox (
    id            UUID PRIMARY KEY,
    exchange      VARCHAR(64)  NOT NULL,
    routing_key   VARCHAR(160) NOT NULL,
    payload       JSONB        NOT NULL,
    headers       JSONB        NOT NULL DEFAULT '{}',
    aggregate_id  UUID,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INTEGER      NOT NULL DEFAULT 0,
    last_error    TEXT
);
CREATE INDEX idx_outbox_pending ON outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_messages (
    message_id    UUID PRIMARY KEY,
    consumer      VARCHAR(64) NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TABLE IF EXISTS processed_messages, outbox, top_ups, ledger_entries, wallets');
    }
};
