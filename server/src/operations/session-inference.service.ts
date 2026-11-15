import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Db, KYSELY } from '../infra/database/database.module';

/** "Bảng Tham Số": how long the server waits for the rebooted workstation's own reports before inferring. */
export const DRAINING_WAIT_SEC = 300;

/**
 * XINV-008: when a workstation comes back with a new boot id, sessions of the old boot are gone with the OS. The agent
 * reports them itself (reconstructed) in its outbox; only what is still open after the wait is closed here, marked as
 * inferred so that a late real report can still replace it once (D-015).
 */
@Injectable()
export class SessionInferenceService {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /** Returns the mqtt identities of the workstations whose draining finished, sorted. */
  async inferAbandoned(): Promise<string[]> {
    return this.db.transaction().execute(async (trx) => {
      const draining = (
        await sql<{ workstation_id: string; mqtt_identity: string; boot_id: string | null; draining_started_at: Date }>`
          SELECT st.workstation_id, w.mqtt_identity, st.boot_id, st.draining_started_at
          FROM workstation_statuses st JOIN workstations w ON w.id = st.workstation_id
          WHERE st.reconcile_state = 'Draining'
            AND st.draining_started_at < now() - ${DRAINING_WAIT_SEC}::int * interval '1 second'
          FOR UPDATE OF st
        `.execute(trx)
      ).rows;
      for (const ws of draining) {
        await sql`
          UPDATE sessions
          SET status = 'abandoned', end_reason = 'workstation_rebooted', end_source = 'inferred',
              ended_at = GREATEST(started_at, LEAST(expires_at, ${ws.draining_started_at}::timestamptz))
          WHERE workstation_id = ${ws.workstation_id}::uuid AND status = 'active'
            AND boot_id IS DISTINCT FROM ${ws.boot_id}
        `.execute(trx);
        await sql`
          UPDATE workstation_statuses SET reconcile_state = 'Idle', draining_started_at = NULL, updated_at = now()
          WHERE workstation_id = ${ws.workstation_id}::uuid
        `.execute(trx);
      }
      return draining.map((ws) => ws.mqtt_identity).sort();
    });
  }
}
