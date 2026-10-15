/**
 * Opaque handle of the unit of work that a driving adapter (e.g. the message inbox) opened.
 * Use cases only pass it through to ports; adapters know its concrete type.
 */
export type TransactionContext = unknown;
