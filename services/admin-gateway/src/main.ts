import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/env';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config));
  await configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`admin-gateway on :${config.port} (/graphql HTTP+WS, introspection=${config.introspection})`);
}

void bootstrap();
