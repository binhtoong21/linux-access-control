import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, AppConfig } from '../config';
import { Db, KYSELY } from '../infra/database/database.module';
import { ReconcileResult, SnapshotService } from './snapshot.service';

// 11-operations/deployment.md "Bảng Tham Số".
/** Coalescing window: changes made within one tick end up in one snapshot version. */
export const TICK_MS = 2_000;
/** Safety net for XINV-005: a full reconcile at startup and then every hour, whatever the outbox says. */
export const FULL_RECONCILE_MS = 60 * 60 * 1000;
const CLAIM_LIMIT = 1000;

export interface OutboxRun {
  /** Pending events claimed and marked processed by this run. */
  events: number;
  results: ReconcileResult[];
}

/**
 * Reads server_outbox and rebuilds snapshots (schedule-sync.md). Level-triggered: an event only says "something changed",
 * the work is always Reconcile(workstation) on the latest committed state, so duplicates and reordering are harmless.
 * Every event type is handled the same way for now; publishing over MQTT comes with the sync milestone.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OutboxWorker');
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | null = null;
  private lastFullAt = 0;
  private failing: string[] = [];

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly snapshots: SnapshotService,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'snapshotWorkerEnabled'>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.snapshotWorkerEnabled) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  /** Stops the timer and waits for the tick in flight, so the database pool is not closed under it. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.current) await this.current;
  }

  /** mqtt_identity of the workstations whose snapshot could not be built at the last reconcile. */
  failures(): string[] {
    return [...this.failing];
  }

  /** One timer tick; a tick still running is reused instead of starting a second one. Never rejects. */
  tick(): Promise<void> {
    if (!this.current) {
      this.current = this.cycle()
        .catch((err: unknown) => this.logger.error(`tick failed, will retry: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => {
          this.current = null;
        });
    }
    return this.current;
  }

  private async cycle(): Promise<void> {
    if (Date.now() - this.lastFullAt >= FULL_RECONCILE_MS) await this.reconcileNow();
    await this.runOnce();
  }

  /** Full reconcile regardless of events (EF-4: server start; then hourly). */
  async reconcileNow(): Promise<ReconcileResult[]> {
    const results = await this.snapshots.reconcileAll();
    this.remember(results);
    return results;
  }

  /** Claims the pending events, reconciles when there are any, marks them processed. */
  async runOnce(): Promise<OutboxRun> {
    return this.db.transaction().execute(async (trx) => {
      // The row locks are held until commit; reconcile runs on other connections and never touches server_outbox.
      const claimed = (
        await sql<{ id: string }>`
          SELECT id FROM server_outbox WHERE status = 'pending' ORDER BY id LIMIT ${CLAIM_LIMIT} FOR UPDATE SKIP LOCKED
        `.execute(trx)
      ).rows;
      if (claimed.length === 0) return { events: 0, results: [] };
      const results = await this.snapshots.reconcileAll();
      this.remember(results);
      const ids = claimed.map((row) => row.id).join(',');
      await sql`
        UPDATE server_outbox SET status = 'processed', processed_at = now()
        WHERE id = ANY(string_to_array(${ids}, ',')::bigint[])
      `.execute(trx);
      return { events: claimed.length, results };
    });
  }

  private remember(results: ReconcileResult[]): void {
    this.lastFullAt = Date.now();
    this.failing = results.filter((r) => r.error !== undefined).map((r) => r.mqtt_identity);
    const issued = results.filter((r) => r.version !== null);
    if (issued.length > 0) this.logger.log(`issued ${issued.map((r) => `${r.mqtt_identity} v${r.version}`).join(', ')}`);
  }
}
