import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';

async function start(databaseUrl: string): Promise<{ app: INestApplication; base: string }> {
  process.env.DATABASE_URL = databaseUrl;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
}

describe('GET /api/v1/system/health', () => {
  const saved = process.env.DATABASE_URL;
  afterAll(() => {
    process.env.DATABASE_URL = saved;
  });

  describe('database unreachable', () => {
    let ctx: { app: INestApplication; base: string };
    beforeAll(async () => {
      ctx = await start('postgres://nobody:x@127.0.0.1:1/none');
    });
    afterAll(() => ctx.app.close());

    it('returns 503 with db down', async () => {
      const res = await fetch(`${ctx.base}/api/v1/system/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: 'degraded', db: 'down' });
    });
  });

  const url = process.env.TEST_DATABASE_URL;
  (url ? describe : describe.skip)('database reachable', () => {
    let ctx: { app: INestApplication; base: string };
    beforeAll(async () => {
      ctx = await start(url as string);
    });
    afterAll(() => ctx.app.close());

    it('returns 200 with db ok', async () => {
      const res = await fetch(`${ctx.base}/api/v1/system/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok', warnings: [] });
    });
  });
});
