CREATE TABLE events (
    id              UUID PRIMARY KEY,
    organizer_id    UUID         NOT NULL,
    university_id   UUID         NOT NULL,
    title           VARCHAR(160) NOT NULL,
    description     TEXT,
    cover_media_id  UUID,
    venue           VARCHAR(200) NOT NULL,
    starts_at       TIMESTAMPTZ  NOT NULL,
    ends_at         TIMESTAMPTZ  NOT NULL,
    capacity        INTEGER      NOT NULL CHECK (capacity > 0),
    seats_taken     INTEGER      NOT NULL DEFAULT 0,
    price_credits   BIGINT       NOT NULL DEFAULT 0 CHECK (price_credits >= 0),
    status          VARCHAR(16)  NOT NULL,
    cancel_reason   VARCHAR(500),
    version         BIGINT       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ,
    CONSTRAINT seats_within_capacity CHECK (seats_taken >= 0 AND seats_taken <= capacity),
    CONSTRAINT ends_after_start CHECK (ends_at > starts_at)
);
CREATE INDEX idx_events_status_starts ON events (status, starts_at);
CREATE INDEX idx_events_organizer ON events (organizer_id, starts_at);

CREATE TABLE registrations (
    id               UUID PRIMARY KEY,
    event_id         UUID        NOT NULL REFERENCES events (id),
    user_id          UUID        NOT NULL,
    status           VARCHAR(24) NOT NULL,
    price_credits    BIGINT      NOT NULL,
    failure_reason   VARCHAR(48),
    ticket_id        UUID,
    idempotency_key  UUID,
    version          BIGINT      NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at     TIMESTAMPTZ,
    cancelled_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_registrations_active ON registrations (event_id, user_id) WHERE status IN ('PENDING', 'CONFIRMED');
CREATE INDEX idx_registrations_user ON registrations (user_id, created_at DESC);
CREATE INDEX idx_registrations_event ON registrations (event_id, status);

CREATE TABLE saga_instances (
    id               UUID PRIMARY KEY,
    registration_id  UUID        NOT NULL REFERENCES registrations (id),
    type             VARCHAR(16) NOT NULL,
    status           VARCHAR(16) NOT NULL,
    step             VARCHAR(16) NOT NULL,
    attempt          SMALLINT    NOT NULL DEFAULT 0,
    deadline_at      TIMESTAMPTZ,
    next_retry_at    TIMESTAMPTZ,
    context          JSONB       NOT NULL,
    failure_reason   VARCHAR(48),
    history          JSONB       NOT NULL DEFAULT '[]',
    version          BIGINT      NOT NULL DEFAULT 0,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_saga_active ON saga_instances (registration_id, type)
    WHERE status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED');
CREATE INDEX idx_saga_deadline ON saga_instances (deadline_at) WHERE status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED');
CREATE INDEX idx_saga_retry ON saga_instances (next_retry_at) WHERE status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED');
CREATE INDEX idx_saga_status_updated ON saga_instances (status, updated_at DESC);

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

CREATE TABLE idempotency_keys (
    scope_key         VARCHAR(200) PRIMARY KEY,
    status            VARCHAR(12)  NOT NULL,
    request_hash      CHAR(64)     NOT NULL,
    principal         VARCHAR(64)  NOT NULL,
    lock_expires_at   TIMESTAMPTZ  NOT NULL,
    response_status   INTEGER,
    response_headers  JSONB,
    response_body     TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
