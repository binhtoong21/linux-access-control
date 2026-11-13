import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from './shared/http/api-exception.filter';
import { validationExceptionFactory } from './shared/http/app-error';

// Shared by main.ts and the e2e tests so both run the same HTTP pipeline.
export function configureApp(app: INestApplication): void {
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
