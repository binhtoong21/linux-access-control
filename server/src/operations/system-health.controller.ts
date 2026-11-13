import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../infra/database/database.module';

const DB_CHECK_TIMEOUT_MS = 2000;

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  db: 'ok' | 'down';
  warnings: string[];
}

// GET /api/v1/system/health (08-api/api.md). mqtt, outbox_backlog and crl_next_update are added with their modules.
@Controller('system')
export class SystemHealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const db = (await this.dbReachable()) ? 'ok' : 'down';
    if (db === 'down') res.status(503);
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      db,
      warnings: [],
    };
  }

  private async dbReachable(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DB_CHECK_TIMEOUT_MS);
    });
    const check = this.pool.query('SELECT 1').then(
      () => true,
      () => false,
    );
    try {
      return await Promise.race([check, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
