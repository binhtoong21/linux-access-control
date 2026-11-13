import { startApp, TestApp } from './support/app';

describe('GET /api/v1/system/health', () => {
  const saved = { db: process.env.DATABASE_URL, jwt: process.env.JWT_SECRET };
  afterAll(() => {
    process.env.DATABASE_URL = saved.db;
    process.env.JWT_SECRET = saved.jwt;
  });

  describe('database unreachable', () => {
    let ctx: TestApp;
    beforeAll(async () => {
      ctx = await startApp('postgres://nobody:x@127.0.0.1:1/none');
    });
    afterAll(() => ctx.app.close());

    it('returns 503 with db down', async () => {
      const res = await fetch(`${ctx.base}/api/v1/system/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: 'degraded', db: 'down' });
    });

    it('answers unknown routes in the API error format', async () => {
      const res = await fetch(`${ctx.base}/api/v1/no-such-route`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as any).error.code).toBe('NOT_FOUND');
    });
  });

  const url = process.env.TEST_DATABASE_URL;
  (url ? describe : describe.skip)('database reachable', () => {
    let ctx: TestApp;
    beforeAll(async () => {
      ctx = await startApp(url as string);
    });
    afterAll(() => ctx.app.close());

    it('returns 200 with db ok', async () => {
      const res = await fetch(`${ctx.base}/api/v1/system/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok', warnings: [] });
    });
  });
});
