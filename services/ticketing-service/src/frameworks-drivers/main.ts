import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';
import { AppModule } from './modules/app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config));
  configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`ticketing-service listening on :${config.port}${config.chaosTicketingFail ? ' (CHAOS_TICKETING_FAIL=true)' : ''}`);
}

void bootstrap();
