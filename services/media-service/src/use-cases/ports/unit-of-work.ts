export const UNIT_OF_WORK = Symbol('UnitOfWork');
export interface UnitOfWork {
  /**
   * Runs `work` in one transaction (joins the ambient one when a consumer already opened it).
   * `work` may be re-executed when the store retries a transient transaction error: keep it free of external side effects.
   */
  run<T>(work: () => Promise<T>): Promise<T>;
}
