import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';
import { AppModule } from './modules/app.module';
import { JsonLogger } from './observability/json-logger';

async function bootstrap(): Promise<void> {
  const logger = new JsonLogger();
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config, { logger }), { logger, bodyParser: true });
  configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');
  logger.info(`insights-service listening on :${config.port}`, { llm: config.llmProvider, tts: config.ttsProvider, monitoring: config.monitoringEnabled });
}

void bootstrap();
