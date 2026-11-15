import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { PkiService } from '../device/pki.service';
import { MqttGateway, MqttState } from '../distribution/mqtt-gateway';
import { OutboxWorker } from '../distribution/outbox-worker';
import { PG_POOL } from '../infra/database/database.module';
import { Public } from '../shared/http/auth.decorators';

const DB_CHECK_TIMEOUT_MS = 2000;
// S9: an expired CRL makes the broker refuse every workstation; warn a month ahead.
const CRL_WARN_MS = 30 * 86_400_000;

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  db: 'ok' | 'down';
  /** Link to the MQTT broker; `disabled` when MQTT_URL is not set. */
  mqtt: MqttState;
  /** Domain events not yet turned into snapshots; null when the database cannot answer. */
  outbox_backlog: number | null;
  /** `nextUpdate` of the CRL file the broker reads; null when it has not been written yet. */
  crl_next_update: string | null;
  warnings: string[];
}

// GET /api/v1/system/health (08-api/api.md).
@Controller('system')
export class SystemHealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly worker: OutboxWorker,
    private readonly pki: PkiService,
    private readonly mqtt: MqttGateway,
  ) {}

  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const db = (await this.dbReachable()) ? 'ok' : 'down';
    if (db === 'down') res.status(503);
    const warnings: string[] = [];
    if (this.worker.failures().length > 0) warnings.push('snapshot_build_failed');
    const crlNextUpdate = this.pki.crlNextUpdate();
    if (crlNextUpdate && crlNextUpdate.getTime() - Date.now() < CRL_WARN_MS) warnings.push('crl_expiring');
    const mqtt = this.mqtt.state();
    return {
      status: db === 'ok' && mqtt !== 'down' ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      db,
      mqtt,
      outbox_backlog: db === 'ok' ? await this.outboxBacklog() : null,
      crl_next_update: crlNextUpdate ? crlNextUpdate.toISOString() : null,
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
