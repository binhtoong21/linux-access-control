import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { createHash, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { Db, KYSELY } from '../infra/database/database.module';
import { isUniqueViolation } from '../infra/database/pg-errors';
import { MASTER_KEY } from '../infra/keys.module';
import { recordAdminAction } from '../shared/admin-audit';
import { deriveKm, newFetchCode } from '../shared/crypto/crypto-v1';
import { InvalidCsrError, parseCsr } from '../shared/crypto/pki';
import { AppError } from '../shared/http/app-error';
import { RateLimiter } from '../shared/http/rate-limiter';
import { emitEvent } from '../shared/outbox';
import { PkiService } from './pki.service';

export const POLL_INTERVAL_SEC = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One enrollment change at a time: duplicate detection reads workstations and pending requests together.
const ENROLLMENT_LOCK = 7403001;

export type EnrollmentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface EnrollmentInput {
  machine_id: string;
  hostname: string;
  mac_address: string;
  csr_pem: string;
}

export interface EnrollmentTicket {
  request_id: string;
  fetch_code: string;
  poll_interval_sec: number;
}

export type EnrollmentStatus =
  | { status: 'pending'; poll_interval_sec: number }
  | { status: 'rejected' }
  | {
      status: 'approved';
      mqtt_identity: string;
      key_version: number;
      client_cert_pem: string;
      k_m: string;
      broker: { host: string; port: number };
    };

export interface WorkstationRef {
  id: string;
  mqtt_identity: string;
}

export interface EnrollmentRequestView {
  id: string;
  hostname: string;
  mac_address: string;
  machine_id: string;
  status: EnrollmentRequestStatus;
  submitted_at: Date;
  reviewed_at: Date | null;
  duplicate_mac_detected: boolean;
  /** The existing workstation this request collides with; such a request can only be approved as a reinstall of it. */
  duplicate_of: WorkstationRef | null;
  /** The workstation created or reinstalled by this request once approved. */
  workstation: WorkstationRef | null;
}

interface ViewRow {
  id: string;
  hostname: string;
  mac_address: string;
  machine_id: string;
  status: EnrollmentRequestStatus;
  submitted_at: Date;
  reviewed_at: Date | null;
  duplicate_mac_detected: boolean;
  duplicate_of_workstation_id: string | null;
  duplicate_identity: string | null;
  workstation_id: string | null;
  workstation_identity: string | null;
  assigned_zone_id: string | null;
}

const notFound = (): AppError => new AppError('NOT_FOUND', 'Enrollment request not found');
const denied = (): AppError => new AppError('INVALID_FETCH_CODE', 'Fetch code is wrong or no longer valid');
const wrongState = (message: string): AppError => new AppError('INVALID_STATE_TRANSITION', message);
const lock = (db: Db) => sql`SELECT pg_advisory_xact_lock(${ENROLLMENT_LOCK}::bigint)`.execute(db);

export interface BatchApproval {
  approved: { id: string; mqtt_identity: string; workstation_id: string }[];
  skipped: { id: string; reason: string }[];
}

const toView = (r: ViewRow): EnrollmentRequestView => ({
  id: r.id,
  hostname: r.hostname,
  mac_address: r.mac_address,
  machine_id: r.machine_id,
  status: r.status,
  submitted_at: r.submitted_at,
  reviewed_at: r.reviewed_at,
  duplicate_mac_detected: r.duplicate_mac_detected,
  duplicate_of: r.duplicate_of_workstation_id ? { id: r.duplicate_of_workstation_id, mqtt_identity: r.duplicate_identity ?? '' } : null,
  workstation: r.workstation_id ? { id: r.workstation_id, mqtt_identity: r.workstation_identity ?? '' } : null,
});

@Injectable()
export class EnrollmentService {
  /** api.md "Rate Limiting". Public so tests can reset them. */
  readonly submitLimiter = new RateLimiter(10, 60_000);
  readonly statusLimiter = new RateLimiter(30, 60_000);

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly pki: PkiService,
    @Inject(MASTER_KEY) private readonly masterKey: Buffer,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'brokerHost' | 'brokerPort'>,
  ) {}

  private async rows(db: Db, filter: { id?: string; status?: EnrollmentRequestStatus }): Promise<ViewRow[]> {
    const id = filter.id ?? null;
    const status = filter.status ?? null;
    return (
      await sql<ViewRow>`
        SELECT r.id, r.hostname, r.mac_address::text AS mac_address, r.machine_id, r.status, r.submitted_at, r.reviewed_at,
               r.duplicate_mac_detected, r.duplicate_of_workstation_id, d.mqtt_identity AS duplicate_identity,
               r.workstation_id, w.mqtt_identity AS workstation_identity, r.assigned_zone_id
        FROM enrollment_requests r
        LEFT JOIN workstations d ON d.id = r.duplicate_of_workstation_id
        LEFT JOIN workstations w ON w.id = r.workstation_id
        WHERE (${id}::uuid IS NULL OR r.id = ${id}::uuid) AND (${status}::text IS NULL OR r.status = ${status}::text)
        ORDER BY r.submitted_at, r.id
      `.execute(db)
    ).rows;
  }

  private async row(db: Db, id: string): Promise<ViewRow> {
    const [row] = await this.rows(db, { id });
    if (!row) throw notFound();
    return row;
  }

  // ------------------------------------------------------------------ agent side (api.md §6)

  /** ADR-002 §7 step 3. Never refuses a duplicate: it is recorded and flagged for the admin (D-014.2). */
  async submit(input: EnrollmentInput, ip: string): Promise<EnrollmentTicket> {
    if (!this.submitLimiter.allow(ip)) throw new AppError('RATE_LIMITED', 'Too many enrollment requests, try again later');
    let publicKey: string;
    try {
      publicKey = (await parseCsr(input.csr_pem)).publicKeyPem;
    } catch (err) {
      if (err instanceof InvalidCsrError) throw new AppError('INVALID_CSR', err.message);
      throw err;
    }
    const machineId = input.machine_id;
    const mac = input.mac_address;
    const { code, hash } = newFetchCode();
    const requestId = await this.db.transaction().execute(async (trx) => {
      await lock(trx);
      // The same machine with the same key is retrying after a lost reply: its older request can no longer be fetched.
      await sql`
        UPDATE enrollment_requests SET status = 'rejected', reviewed_at = now()
        WHERE status = 'pending' AND machine_id = ${machineId} AND public_key = ${publicKey}
      `.execute(trx);
      const existing = (
        await sql<{ id: string }>`
          SELECT id FROM workstations WHERE machine_id = ${machineId} OR mac_address = ${mac}::macaddr
          ORDER BY (machine_id = ${machineId}) DESC, id LIMIT 1
        `.execute(trx)
      ).rows[0];
      const pending = (
        await sql<{ id: string }>`
          SELECT id FROM enrollment_requests
          WHERE status = 'pending' AND (machine_id = ${machineId} OR mac_address = ${mac}::macaddr)
        `.execute(trx)
      ).rows;
      const duplicate = existing !== undefined || pending.length > 0;
      const inserted = (
        await sql<{ id: string }>`
          INSERT INTO enrollment_requests
            (fetch_code_hash, machine_id, mac_address, hostname, csr_pem, public_key, duplicate_mac_detected, duplicate_of_workstation_id)
          VALUES (${hash}, ${machineId}, ${mac}::macaddr, ${input.hostname.trim()}, ${input.csr_pem}, ${publicKey}, ${duplicate},
                  ${existing?.id ?? null}::uuid)
          RETURNING id
        `.execute(trx)
      ).rows[0];
      if (pending.length > 0) {
        await sql`
          UPDATE enrollment_requests SET duplicate_mac_detected = true
          WHERE status = 'pending' AND (machine_id = ${machineId} OR mac_address = ${mac}::macaddr)
        `.execute(trx);
      }
      return inserted.id;
    });
    return { request_id: requestId, fetch_code: code, poll_interval_sec: POLL_INTERVAL_SEC };
  }

  /**
   * ADR-002 §7 step 5. The credentials are handed out as often as asked until the workstation's first Hello invalidates
   * the code (D-014.4), so a lost reply never strands an approved workstation.
   */
  async status(requestId: string, fetchCode: string | undefined): Promise<EnrollmentStatus> {
    if (!fetchCode || !UUID.test(requestId)) throw denied();
    if (!this.statusLimiter.allow(requestId.toLowerCase())) throw new AppError('RATE_LIMITED', 'Too many status requests, slow down');
    const row = (
      await sql<{
        status: EnrollmentRequestStatus;
        hash: string;
        fetch_code_invalidated_at: Date | null;
        issued_cert_pem: string | null;
        mqtt_identity: string | null;
        key_version: number | null;
      }>`
        SELECT r.status, r.fetch_code_hash::text AS hash, r.fetch_code_invalidated_at, r.issued_cert_pem, w.mqtt_identity, w.key_version
        FROM enrollment_requests r LEFT JOIN workstations w ON w.id = r.workstation_id
        WHERE r.id = ${requestId}::uuid
      `.execute(this.db)
    ).rows[0];
    const given = createHash('sha256').update(fetchCode).digest();
    if (!row || row.fetch_code_invalidated_at !== null || !timingSafeEqual(given, Buffer.from(row.hash, 'hex'))) throw denied();
    if (row.status === 'pending') return { status: 'pending', poll_interval_sec: POLL_INTERVAL_SEC };
    if (row.status === 'rejected') return { status: 'rejected' };
    if (row.issued_cert_pem === null || row.mqtt_identity === null || row.key_version === null) throw denied();
    return {
      status: 'approved',
      mqtt_identity: row.mqtt_identity,
      key_version: row.key_version,
      client_cert_pem: row.issued_cert_pem,
      // K_m is derived, never stored (ADR-007); it travels only over the TLS channel the agent pinned to the CA (D-014.3).
      k_m: deriveKm(this.masterKey, row.mqtt_identity, row.key_version).toString('hex'),
      broker: { host: this.config.brokerHost, port: this.config.brokerPort },
    };
  }

  // ------------------------------------------------------------------ admin side (api.md "Đăng ký máy")

  async list(status: EnrollmentRequestStatus = 'pending'): Promise<EnrollmentRequestView[]> {
    return (await this.rows(this.db, { status })).map(toView);
  }

  /** INV-010: only an admin turns a request into a workstation. INV-009: a duplicate of a workstation is never a new one. */
  async approveNew(id: string, mqttIdentity: string, zoneId: string | null, actorId: string): Promise<EnrollmentRequestView> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        await lock(trx);
        const request = (
          await sql<{ status: EnrollmentRequestStatus; machine_id: string; mac_address: string; hostname: string; csr_pem: string; public_key: string }>`
            SELECT status, machine_id, mac_address::text AS mac_address, hostname, csr_pem, public_key
            FROM enrollment_requests WHERE id = ${id}::uuid FOR UPDATE
          `.execute(trx)
        ).rows[0];
        if (!request) throw notFound();
        const current = await this.row(trx, id);
        if (request.status === 'approved') {
          // Idempotent (api.md): the same parameters give the first result again.
          if (current.workstation_identity === mqttIdentity && current.assigned_zone_id === zoneId) return toView(current);
          throw wrongState('The request was already approved with other parameters');
        }
        if (request.status === 'rejected') throw wrongState('The request was rejected');
        if (current.duplicate_of_workstation_id !== null) {
          throw new AppError('DUPLICATE_REQUIRES_REINSTALL', 'The request matches an existing workstation; approve it as a reinstall or reject it', [
            { workstation_id: current.duplicate_of_workstation_id, mqtt_identity: current.duplicate_identity },
          ]);
        }
        if (zoneId !== null) {
          const zone = (await sql`SELECT 1 FROM zones WHERE id = ${zoneId}::uuid FOR SHARE`.execute(trx)).rows[0];
          if (!zone) throw new AppError('VALIDATION_ERROR', 'Zone does not exist', [{ field: 'zone_id', constraints: ['zone not found'] }]);
        }
        const taken = (await sql`SELECT 1 FROM workstations WHERE mqtt_identity = ${mqttIdentity}`.execute(trx)).rows[0];
        if (taken) throw duplicateName();

        const certificate = await this.pki.ca.issue(request.csr_pem, mqttIdentity);
        const workstation = (
          await sql<{ id: string; key_version: number }>`
            INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key, cert_serial, cert_expires_at, zone_id)
            VALUES (${mqttIdentity}, ${request.machine_id}, ${request.mac_address}::macaddr, ${request.hostname}, ${request.public_key},
                    ${certificate.serial}, ${certificate.expiresAt}, ${zoneId}::uuid)
            RETURNING id, key_version
          `.execute(trx)
        ).rows[0];
        await sql`
          UPDATE enrollment_requests
          SET status = 'approved', workstation_id = ${workstation.id}::uuid, assigned_zone_id = ${zoneId}::uuid,
              issued_cert_pem = ${certificate.pem}, reviewed_at = now(), reviewed_by = ${actorId}::uuid
          WHERE id = ${id}::uuid
        `.execute(trx);
        // Other requests of the same machine now collide with a real workstation (INV-009).
        await sql`
          UPDATE enrollment_requests SET duplicate_mac_detected = true, duplicate_of_workstation_id = ${workstation.id}::uuid
          WHERE status = 'pending' AND (machine_id = ${request.machine_id} OR mac_address = ${request.mac_address}::macaddr)
        `.execute(trx);
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'enrollment.approve',
          entityType: 'workstation',
          entityId: workstation.id,
          after: { request_id: id, mode: 'new', mqtt_identity: mqttIdentity, zone_id: zoneId, cert_serial: certificate.serial },
        });
        await emitEvent(trx, {
          aggregateType: 'workstation',
          aggregateId: workstation.id,
          eventType: 'WorkstationEnrollmentApproved',
          payload: { request_id: id, mode: 'new', key_version: workstation.key_version },
        });
        return toView(await this.row(trx, id));
      });
    } catch (err) {
      if (isUniqueViolation(err, 'uq_workstations_mqtt_identity')) throw duplicateName();
      if (isUniqueViolation(err)) throw new AppError('DUPLICATE_REQUIRES_REINSTALL', 'A workstation with this MAC or machine id already exists');
      throw err;
    }
  }

  /**
   * D-014.2: a request that collides with an existing workstation is that workstation being reinstalled (new disk,
   * `nfc-agent reenroll`). It keeps its name, zone, schedules and history; the key version goes up, so K_m changes and the
   * next snapshot is signed with the new key, and the previous certificate is revoked.
   */
  async approveReinstall(id: string, actorId: string): Promise<EnrollmentRequestView> {
    let revoked = false;
    let view: EnrollmentRequestView;
    try {
      view = await this.db.transaction().execute(async (trx) => {
        await lock(trx);
        const request = (
          await sql<{ status: EnrollmentRequestStatus; machine_id: string; mac_address: string; hostname: string; csr_pem: string; public_key: string }>`
            SELECT status, machine_id, mac_address::text AS mac_address, hostname, csr_pem, public_key
            FROM enrollment_requests WHERE id = ${id}::uuid FOR UPDATE
          `.execute(trx)
        ).rows[0];
        if (!request) throw notFound();
        const current = await this.row(trx, id);
        if (request.status === 'approved') {
          // Idempotent: a request approved as a reinstall points at the workstation it collided with.
          if (current.duplicate_of_workstation_id !== null && current.duplicate_of_workstation_id === current.workstation_id) return toView(current);
          throw wrongState('The request was already approved as a new workstation');
        }
        if (request.status === 'rejected') throw wrongState('The request was rejected');
        const workstationId = current.duplicate_of_workstation_id;
        if (workstationId === null) throw wrongState('The request does not match an existing workstation; approve it as a new one');
        const workstation = (
          await sql<{ mqtt_identity: string; key_version: number; cert_serial: string | null; zone_id: string | null }>`
            SELECT mqtt_identity, key_version, cert_serial, zone_id FROM workstations WHERE id = ${workstationId}::uuid FOR UPDATE
          `.execute(trx)
        ).rows[0];
        if (!workstation) throw notFound();

        const certificate = await this.pki.ca.issue(request.csr_pem, workstation.mqtt_identity);
        const keyVersion = workstation.key_version + 1;
        await sql`
          UPDATE workstations
          SET key_version = ${keyVersion}, machine_id = ${request.machine_id}, mac_address = ${request.mac_address}::macaddr,
              hostname = ${request.hostname}, public_key = ${request.public_key}, cert_serial = ${certificate.serial},
              cert_expires_at = ${certificate.expiresAt}, status = 'enrolled', updated_at = now()
          WHERE id = ${workstationId}::uuid
        `.execute(trx);
        if (workstation.cert_serial !== null) {
          // Already there when the workstation was disabled before; a revoked certificate is never un-revoked (D-014.6).
          await sql`
            INSERT INTO revoked_certificates (cert_serial, workstation_id, reason)
            VALUES (${workstation.cert_serial}, ${workstationId}::uuid, 'reinstalled')
            ON CONFLICT (cert_serial) DO NOTHING
          `.execute(trx);
          revoked = true;
        }
        // Earlier enrollments of this workstation must not be fetchable any more: they would now hand out the new K_m.
        await sql`
          UPDATE enrollment_requests SET fetch_code_invalidated_at = now()
          WHERE workstation_id = ${workstationId}::uuid AND id <> ${id}::uuid AND fetch_code_invalidated_at IS NULL
        `.execute(trx);
        await sql`
          UPDATE enrollment_requests
          SET status = 'approved', workstation_id = ${workstationId}::uuid, assigned_zone_id = ${workstation.zone_id}::uuid,
              issued_cert_pem = ${certificate.pem}, reviewed_at = now(), reviewed_by = ${actorId}::uuid
          WHERE id = ${id}::uuid
        `.execute(trx);
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'enrollment.approve',
          entityType: 'workstation',
          entityId: workstationId,
          before: { key_version: workstation.key_version, cert_serial: workstation.cert_serial },
          after: { request_id: id, mode: 'reinstall', key_version: keyVersion, cert_serial: certificate.serial },
        });
        await emitEvent(trx, {
          aggregateType: 'workstation',
          aggregateId: workstationId,
          eventType: 'WorkstationEnrollmentApproved',
          payload: { request_id: id, mode: 'reinstall', key_version: keyVersion },
        });
        return toView(await this.row(trx, id));
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('DUPLICATE_REQUIRES_REINSTALL', 'The MAC or machine id of this request belongs to another workstation');
      }
      throw err;
    }
    // After commit (D-014.5): the broker reads the CRL file, not the database.
    if (revoked) await this.pki.revocationChanged();
    return view;
  }

  /**
   * "Duyệt tất cả" of a zone (D-014.1). Each request is approved in its own transaction; flagged requests are never
   * approved in bulk, an admin has to look at them one by one.
   */
  async approveBatch(zoneId: string, requestIds: string[], prefix: string, actorId: string): Promise<BatchApproval> {
    const zone = (await sql`SELECT 1 FROM zones WHERE id = ${zoneId}::uuid`.execute(this.db)).rows[0];
    if (!zone) throw new AppError('VALIDATION_ERROR', 'Zone does not exist', [{ field: 'zone_id', constraints: ['zone not found'] }]);
    const used = (
      await sql<{ mqtt_identity: string }>`
        SELECT mqtt_identity FROM workstations WHERE left(mqtt_identity, ${prefix.length}::int) = ${prefix}
      `.execute(this.db)
    ).rows;
    // Continue after the highest number already used with this prefix: lab-a-01, lab-a-02, …
    let last = 0;
    for (const { mqtt_identity } of used) {
      const suffix = mqtt_identity.slice(prefix.length);
      if (/^\d+$/.test(suffix)) last = Math.max(last, Number(suffix));
    }
    const result: BatchApproval = { approved: [], skipped: [] };
    for (const id of [...new Set(requestIds)]) {
      const [row] = await this.rows(this.db, { id });
      const reason = !row ? 'not_found' : row.status !== 'pending' ? 'not_pending' : row.duplicate_mac_detected ? 'duplicate' : null;
      if (reason !== null) {
        result.skipped.push({ id, reason });
        continue;
      }
      const name = `${prefix}${String(last + 1).padStart(2, '0')}`;
      try {
        const view = await this.approveNew(id, name, zoneId, actorId);
        last += 1;
        result.approved.push({ id, mqtt_identity: name, workstation_id: view.workstation?.id ?? '' });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        result.skipped.push({ id, reason: err.code.toLowerCase() });
      }
    }
    return result;
  }

  /** The agent sees `rejected` and stops polling; a technician runs `nfc-agent reenroll` to try again. */
  async reject(id: string, note: string | undefined, actorId: string): Promise<EnrollmentRequestView> {
    return this.db.transaction().execute(async (trx) => {
      await lock(trx);
      const request = (
        await sql<{ status: EnrollmentRequestStatus }>`SELECT status FROM enrollment_requests WHERE id = ${id}::uuid FOR UPDATE`.execute(trx)
      ).rows[0];
      if (!request) throw notFound();
      if (request.status === 'approved') throw wrongState('The request was already approved');
      if (request.status === 'pending') {
        await sql`
          UPDATE enrollment_requests SET status = 'rejected', reviewed_at = now(), reviewed_by = ${actorId}::uuid WHERE id = ${id}::uuid
        `.execute(trx);
        await recordAdminAction(trx, {
          adminId: actorId,
          action: 'enrollment.reject',
          entityType: 'enrollment_request',
          entityId: id,
          after: { note: note?.trim() || null },
        });
      }
      return toView(await this.row(trx, id));
    });
  }
}

function duplicateName(): AppError {
  return new AppError('DUPLICATE', 'A workstation with this name already exists', [{ field: 'mqtt_identity', constraints: ['name already used'] }]);
}
