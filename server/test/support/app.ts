import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { testKeysDir } from './keys';

export const TEST_JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789';

export interface TestApp {
  app: INestApplication;
  base: string;
}

/** Boots the real AppModule with the production HTTP pipeline on a random local port. */
export async function startApp(databaseUrl: string): Promise<TestApp> {
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.KEYS_DIR = testKeysDir();
  process.env.UID_ENC_KEY_ID = 'k1';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
}
