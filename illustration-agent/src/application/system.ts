import { randomUUID } from "node:crypto";

import type { Clock, IdGenerator } from "../ports.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class UuidGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}
