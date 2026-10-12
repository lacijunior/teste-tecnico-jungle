import { Injectable } from '@nestjs/common';
import type { Clock } from '../../application/ports/clock.js';

@Injectable()
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
