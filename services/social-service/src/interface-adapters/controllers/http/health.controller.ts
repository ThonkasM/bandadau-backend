import { Public } from '@bandada/auth-ts/nest';
import { RABBIT_CLIENT } from '@bandada/messaging-ts/nest';
import type { RabbitMqClient } from '@bandada/messaging-ts';
import { Controller, Get, HttpException, Inject, Optional } from '@nestjs/common';

import { MongoContext } from '../../gateways/mongo/mongo-context';

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

@Controller('health')
@Public()
export class HealthController {
  constructor(
    @Inject(MongoContext) private readonly mongo: MongoContext,
    @Optional() @Inject(RABBIT_CLIENT) private readonly rabbit?: RabbitMqClient,
  ) {}

  @Get('live')
  live(): { status: 'UP' } {
    return { status: 'UP' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'UP'; checks: Record<string, 'UP'> }> {
    const checks: Record<string, 'UP' | 'DOWN'> = { mongo: 'DOWN', rabbitmq: this.rabbit ? 'DOWN' : 'UP' };
    await withTimeout(this.mongo.db.command({ ping: 1 }), 1500).then(() => (checks.mongo = 'UP')).catch(() => undefined);
    if (this.rabbit) await withTimeout(this.rabbit.publisherChannel().waitForConnect(), 1500).then(() => (checks.rabbitmq = 'UP')).catch(() => undefined);
    if (Object.values(checks).some((v) => v === 'DOWN')) throw new HttpException({ status: 'DOWN', checks }, 503);
    return { status: 'UP', checks: checks as Record<string, 'UP'> };
  }
}
