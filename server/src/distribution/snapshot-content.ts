import { createHash } from 'node:crypto';
import { cardMatchKey, sign } from '../shared/crypto/crypto-v1';

// Snapshot of one workstation (08-api/events.md §4.1, contracts/schemas/snapshot-v1.schema.json). Pure: no I/O.
// The content is canonical (fixed key order, sorted arrays), so equal data always gives equal bytes and an equal hash,
// and a new version is issued only when the content really changed (schedule-sync.md, principle 7).

/** 11-operations/deployment.md "Bảng Tham Số": a larger snapshot is a build error, not something to publish. */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024;

/** Sent to the Agent with every snapshot ("Bảng Tham Số": lease 24h, warning 5 min, longest session 12h). */
export const SNAPSHOT_PARAMETERS = { lease_duration_sec: 86400, warning_before_sec: 300, max_session_duration_sec: 43200 } as const;

const DAY_BITS: Readonly<Record<string, number>> = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 4, THURSDAY: 8, FRIDAY: 16, SATURDAY: 32, SUNDAY: 64 };

/** What the server knows about one workstation, in any order. `uid` is the normalized plain UID; it never leaves this module. */
export interface SnapshotData {
  mqttIdentity: string;
  keyVersion: number;
  users: { id: string; external_id: string; full_name: string; status: 'active' | 'inactive'; group_ids: string[] }[];
  cards: { id: string; user_id: string; status: 'active' | 'disabled'; uid: string }[];
  schedules: {
    id: string;
    subject_type: 'user' | 'group';
    subject_id: string;
    valid_from: string;
    valid_to: string | null;
    days_of_week: string[];
    start_minute: number;
    end_minute: number;
    target_os_username: string | null;
  }[];
  profiles: { os_username: string; status: 'enabled' | 'disabled'; is_default: boolean }[];
}

/** Everything of the wire format except `version` and `created_at`, which do not describe the content. */
export interface SnapshotContent {
  schema: 'snapshot-v1';
  workstation_id: string;
  key_version: number;
  uid_scheme: 'hmac-sha256-v1';
  parameters: typeof SNAPSHOT_PARAMETERS;
  users: { id: string; external_id: string; full_name: string; status: 'active' | 'inactive'; group_ids: string[] }[];
  cards: { match_key: string; card_id: string; user_id: string; status: 'active' | 'disabled' }[];
  schedules: {
    id: string;
    subject_type: 'user' | 'group';
    subject_id: string;
    valid_from: string;
    valid_to: string | null;
    days_mask: number;
    start_minute: number;
    end_minute: number;
    target_os_username: string | null;
  }[];
  profiles: { os_username: string; status: 'enabled' | 'disabled'; is_default: boolean }[];
}

export interface SignedSnapshot {
  /** The exact bytes to publish and to store (snapshots.payload_raw). */
  raw: Buffer;
  /** hex(HMAC-SHA256(K_m, "snapshot-v1:" ‖ raw)), sent as the MQTT user property `signature`. */
  signature: string;
}

export class SnapshotTooLargeError extends Error {}

// Plain code-unit order: the same on every machine and locale, unlike localeCompare.
const byKey =
  <T>(key: (item: T) => string) =>
  (a: T, b: T): number =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/** Monday = 1 … Sunday = 64 (events.md §4.1). */
export function daysMask(days: string[]): number {
  let mask = 0;
  for (const day of days) {
    const bit = DAY_BITS[day];
    if (bit === undefined) throw new Error(`unknown day of week: ${day}`);
    mask |= bit;
  }
  return mask;
}

export function canonicalContent(data: SnapshotData, km: Buffer): SnapshotContent {
  return {
    schema: 'snapshot-v1',
    workstation_id: data.mqttIdentity,
    key_version: data.keyVersion,
    uid_scheme: 'hmac-sha256-v1',
    parameters: SNAPSHOT_PARAMETERS,
    users: data.users
      .map((u) => ({ id: u.id, external_id: u.external_id, full_name: u.full_name, status: u.status, group_ids: [...u.group_ids].sort() }))
      .sort(byKey((u) => u.id)),
    cards: data.cards
      .map((c) => ({ match_key: cardMatchKey(km, c.uid), card_id: c.id, user_id: c.user_id, status: c.status }))
      .sort(byKey((c) => c.card_id)),
    schedules: data.schedules
      .map((s) => ({
        id: s.id,
        subject_type: s.subject_type,
        subject_id: s.subject_id,
        valid_from: s.valid_from,
        valid_to: s.valid_to,
        days_mask: daysMask(s.days_of_week),
        start_minute: s.start_minute,
        end_minute: s.end_minute,
        target_os_username: s.target_os_username,
      }))
      .sort(byKey((s) => s.id)),
    profiles: data.profiles
      .map((p) => ({ os_username: p.os_username, status: p.status, is_default: p.is_default }))
      .sort(byKey((p) => p.os_username)),
  };
}

/** SHA-256 hex of the canonical content (snapshots.content_hash). */
export function contentHash(content: SnapshotContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Wire bytes of `snapshot-v1` for this version, signed with K_m. `createdAt` is UTC epoch seconds. */
export function encodeSnapshot(content: SnapshotContent, km: Buffer, version: number, createdAt: number): SignedSnapshot {
  const raw = Buffer.from(
    JSON.stringify({
      schema: content.schema,
      workstation_id: content.workstation_id,
      version,
      key_version: content.key_version,
      uid_scheme: content.uid_scheme,
      created_at: createdAt,
      parameters: content.parameters,
      users: content.users,
      cards: content.cards,
      schedules: content.schedules,
      profiles: content.profiles,
    }),
    'utf8',
  );
  if (raw.length > SNAPSHOT_MAX_BYTES) {
    throw new SnapshotTooLargeError(`snapshot of ${content.workstation_id} is ${raw.length} bytes, over the limit of ${SNAPSHOT_MAX_BYTES}`);
  }
  return { raw, signature: sign(km, 'snapshot-v1', raw) };
}
