-- Soporta la purga periódica de filas publicadas (OutboxRelay.purge).
CREATE INDEX idx_outbox_published ON outbox (published_at) WHERE published_at IS NOT NULL;
