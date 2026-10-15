import { DescribeTableCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Public } from '@bandada/auth-ts/nest';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';

import { DYNAMO_CLIENT, TICKETING_TABLE } from '../modules/tokens';

@Controller('health')
export class HealthController {
  private lastOk = 0;

  constructor(
    @Inject(DYNAMO_CLIENT) private readonly dynamo: DynamoDBClient,
    @Inject(TICKETING_TABLE) private readonly table: string,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'UP' };
  }

  @Public()
  @Get('ready')
  async ready() {
    if (Date.now() - this.lastOk > 3000) {
      try {
        await this.dynamo.send(new DescribeTableCommand({ TableName: this.table }));
        this.lastOk = Date.now();
      } catch {
        throw new ServiceUnavailableException({ status: 'DOWN', checks: { dynamodb: 'DOWN' } });
      }
    }
    return { status: 'UP', checks: { dynamodb: 'UP' } };
  }
}
