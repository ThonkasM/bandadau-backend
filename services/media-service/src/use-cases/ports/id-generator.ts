export const ID_GENERATOR = Symbol('IdGenerator');
export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}
