CREATE TABLE universities (
    id          UUID PRIMARY KEY,
    name        VARCHAR(160) NOT NULL,
    enabled     BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One row per allowed domain: the primary key guarantees a domain belongs to a single university.
CREATE TABLE university_domains (
    domain         VARCHAR(255) PRIMARY KEY,
    university_id  UUID NOT NULL REFERENCES universities (id) ON DELETE CASCADE
);
CREATE INDEX idx_university_domains_university ON university_domains (university_id);

CREATE TABLE users (
    id                 UUID PRIMARY KEY,
    email              VARCHAR(254) NOT NULL,
    university_id      UUID         NOT NULL REFERENCES universities (id),
    status             VARCHAR(24)  NOT NULL,
    roles              TEXT[]       NOT NULL DEFAULT '{STUDENT}',
    locale             VARCHAR(2)   NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
    theme              VARCHAR(6)   NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM', 'LIGHT', 'DARK')),
    email_verified_at  TIMESTAMPTZ,
    suspended_reason   VARCHAR(500),
    version            BIGINT       NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_roles ON users USING GIN (roles);

CREATE TABLE credentials (
    user_id          UUID PRIMARY KEY REFERENCES users (id),
    password_hash    VARCHAR(255) NOT NULL,
    failed_attempts  SMALLINT     NOT NULL DEFAULT 0,
    locked_until     TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE email_verifications (
    id           UUID PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES users (id),
    code_hash    CHAR(64)    NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    attempts     SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts <= 6),
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_verif_user ON email_verifications (user_id, created_at DESC);

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY,
    user_id     UUID        NOT NULL,
    family_id   UUID        NOT NULL,
    client      VARCHAR(8)  NOT NULL,
    token_hash  CHAR(64)    NOT NULL UNIQUE,
    parent_id   UUID,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_family ON refresh_tokens (family_id);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id);

CREATE TABLE handoff_codes (
    code_hash       CHAR(64) PRIMARY KEY,
    user_id         UUID         NOT NULL,
    target_app      VARCHAR(8)   NOT NULL,
    code_challenge  VARCHAR(128) NOT NULL,
    expires_at      TIMESTAMPTZ  NOT NULL,
    used_at         TIMESTAMPTZ,
    created_ip      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_handoff_expires ON handoff_codes (expires_at);

CREATE TABLE signing_keys (
    kid              VARCHAR(32) PRIMARY KEY,
    public_jwk       JSONB       NOT NULL,
    private_key_enc  BYTEA       NOT NULL,
    status           VARCHAR(12) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at     TIMESTAMPTZ,
    retired_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_one_active_key ON signing_keys (status) WHERE status = 'ACTIVE';

CREATE TABLE role_changes (
    id          UUID PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id),
    actor_id    UUID        NOT NULL,
    old_roles   TEXT[]      NOT NULL,
    new_roles   TEXT[]      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
