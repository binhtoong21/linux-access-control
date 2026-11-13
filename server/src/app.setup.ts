import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from './shared/http/api-exception.filter';
import { validationExceptionFactory } from './shared/http/app-error';

// Shared by main.ts and the e2e tests so both run the same HTTP pipeline.
export function configureApp(app: INestApplication): void {
  // Behind Nginx on the same host: trust X-Forwarded-For only from loopback, so req.ip is the real client (login throttle).
  (app as NestExpressApplication).set('trust proxy', 'loopback');
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
}
