import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { OutboxWorker } from '../distribution/outbox-worker';
import { PG_POOL } from '../infra/database/database.module';
import { Public } from '../shared/http/auth.decorators';

const DB_CHECK_TIMEOUT_MS = 2000;

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  db: 'ok' | 'down';
  /** Domain events not yet turned into snapshots; null when the database cannot answer. */
  outbox_backlog: number | null;
  warnings: string[];
}

// GET /api/v1/system/health (08-api/api.md). mqtt and crl_next_update are added with their modules.
@Controller('system')
export class SystemHealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly worker: OutboxWorker,
  ) {}

  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const db = (await this.dbReachable()) ? 'ok' : 'down';
    if (db === 'down') res.status(503);
    const warnings: string[] = [];
    if (this.worker.failures().length > 0) warnings.push('snapshot_build_failed');
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      db,
      outbox_backlog: db === 'ok' ? await this.outboxBacklog() : null,
      warnings,
    };
  }

  private async outboxBacklog(): Promise<number | null> {
    try {
      const res = await this.pool.query("SELECT count(*)::int AS pending FROM server_outbox WHERE status = 'pending'");
      return res.rows[0].pending;
    } catch {
      return null;
    }
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
