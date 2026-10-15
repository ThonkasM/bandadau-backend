-- D-10: nombre visible opcional recibido en el registro (si es NULL se deriva del correo al verificarlo).
ALTER TABLE users ADD COLUMN display_name VARCHAR(80);

-- UC-22: tokens MCP emitidos por createMcpToken. Solo se guarda el jti y metadatos (nunca el JWT) para poder revocarlos.
CREATE TABLE mcp_tokens (
    id          UUID PRIMARY KEY,                 -- = jti del JWT
    user_id     UUID         NOT NULL REFERENCES users (id),
    label       VARCHAR(80),
    created_at  TIMESTAMPTZ  NOT NULL,
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX idx_mcp_tokens_user ON mcp_tokens (user_id, created_at DESC);

-- D-16: ventana fija compartida entre instancias (RATE_LIMIT_STORE=postgres). Una fila por clave; UPSERT atómico.
CREATE TABLE rate_limit_windows (
    limit_key     VARCHAR(200) PRIMARY KEY,
    window_start  TIMESTAMPTZ NOT NULL,
    hits          INTEGER     NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_rate_limit_expires ON rate_limit_windows (expires_at);
