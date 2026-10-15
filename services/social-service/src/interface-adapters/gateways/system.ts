import { uuidv7 } from '@bandada/messaging-ts';

import type { Clock, IdGenerator } from '../../use-cases/ports';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
