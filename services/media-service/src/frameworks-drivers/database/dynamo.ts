import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { Env } from '../config/env';

/** DynamoDB Local in dev (`DYNAMODB_ENDPOINT`), AWS otherwise. Credentials come from the standard AWS_* variables. */
export function createDynamoDocClient(env: Pick<Env, 'AWS_REGION' | 'DYNAMODB_ENDPOINT'>): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION, ...(env.DYNAMODB_ENDPOINT ? { endpoint: env.DYNAMODB_ENDPOINT } : {}) }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}
