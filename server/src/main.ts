import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, AppConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks(); // closes the DB pool on SIGTERM (systemd stop)
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '127.0.0.1'); // behind Nginx (deployment.md)
}

void bootstrap();
