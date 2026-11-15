import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalContent,
  contentHash,
  daysMask,
  encodeSnapshot,
  SNAPSHOT_MAX_BYTES,
  SnapshotData,
  SnapshotTooLargeError,
} from '../../src/distribution/snapshot-content';
import { cardMatchKey, deriveKm, verify } from '../../src/shared/crypto/crypto-v1';

const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'schemas', 'snapshot-v1.schema.json'), 'utf8'));
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const km = deriveKm(Buffer.alloc(32, 7), 'ws-01', 2);

const data = (): SnapshotData => ({
  mqttIdentity: 'ws-01',
  keyVersion: 2,
  users: [
    { id: id(2), external_id: 'SV002', full_name: 'Trần Thị B', status: 'inactive', group_ids: [] },
    { id: id(1), external_id: 'SV001', full_name: 'Nguyễn Văn A', status: 'active', group_ids: [id(12), id(11)] },
  ],
  cards: [
    { id: id(22), user_id: id(2), status: 'disabled', uid: '04A32B1C5D6E80' },
    { id: id(21), user_id: id(1), status: 'active', uid: '1F0820CF' },
  ],
  schedules: [
    {
      id: id(32),
      subject_type: 'user',
      subject_id: id(2),
      valid_from: '2026-12-01',
      valid_to: '2027-01-15',
      days_of_week: ['SUNDAY'],
      start_minute: 1080,
      end_minute: 1440,
      target_os_username: 'exam',
    },
    {
      id: id(31),
      subject_type: 'group',
      subject_id: id(11),
      valid_from: '2026-09-01',
      valid_to: null,
      days_of_week: ['FRIDAY', 'MONDAY', 'WEDNESDAY'],
      start_minute: 450,
      end_minute: 690,
      target_os_username: null,
    },
  ],
  profiles: [
    { os_username: 'student', status: 'enabled', is_default: true },
    { os_username: 'exam', status: 'disabled', is_default: false },
  ],
});

/** The same data with every list in the opposite order. */
const reversed = (): SnapshotData => {
  const d = data();
  return {
    ...d,
    users: d.users.map((u) => ({ ...u, group_ids: [...u.group_ids].reverse() })).reverse(),
    cards: [...d.cards].reverse(),
    schedules: d.schedules.map((s) => ({ ...s, days_of_week: [...s.days_of_week].reverse() })).reverse(),
    profiles: [...d.profiles].reverse(),
  };
};

describe('snapshot content', () => {
  it('encodes a snapshot that matches the contract schema, in the documented key order', () => {
    const { raw } = encodeSnapshot(canonicalContent(data(), km), km, 13, 1793049300.5);
    const parsed = JSON.parse(raw.toString('utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect([validate(parsed), validate.errors]).toEqual([true, null]);
    expect(Object.keys(parsed)).toEqual([
      'schema',
      'workstation_id',
      'version',
      'key_version',
      'uid_scheme',
      'created_at',
      'parameters',
      'users',
      'cards',
      'schedules',
      'profiles',
    ]);
    expect(parsed).toMatchObject({ schema: 'snapshot-v1', workstation_id: 'ws-01', version: 13, key_version: 2, created_at: 1793049300.5 });
    expect(parsed.parameters).toEqual({ lease_duration_sec: 86400, warning_before_sec: 300, max_session_duration_sec: 43200 });
  });

  it('sorts every list and turns weekdays into a mask', () => {
    const content = canonicalContent(data(), km);
    expect(content.users.map((u) => u.id)).toEqual([id(1), id(2)]);
    expect(content.users[0].group_ids).toEqual([id(11), id(12)]);
    expect(content.cards.map((c) => c.card_id)).toEqual([id(21), id(22)]);
    expect(content.schedules.map((s) => [s.id, s.days_mask])).toEqual([
      [id(31), 21],
      [id(32), 64],
    ]);
    expect(content.profiles.map((p) => p.os_username)).toEqual(['exam', 'student']);
  });

  it('replaces card UIDs by the match key of this workstation and keeps names as UTF-8', () => {
    const { raw } = encodeSnapshot(canonicalContent(data(), km), km, 1, 1);
    const text = raw.toString('utf8');
    expect(text).not.toContain('1F0820CF');
    expect(text).not.toContain('04A32B1C5D6E80');
    expect(text).toContain('Nguyễn Văn A');
    expect(JSON.parse(text).cards[0]).toEqual({ match_key: cardMatchKey(km, '1F0820CF'), card_id: id(21), user_id: id(1), status: 'active' });
    const other = deriveKm(Buffer.alloc(32, 7), 'ws-02', 2);
    expect(canonicalContent(data(), other).cards[0].match_key).not.toBe(cardMatchKey(km, '1F0820CF'));
  });

  it('signs the exact bytes with the snapshot-v1 tag', () => {
    const { raw, signature } = encodeSnapshot(canonicalContent(data(), km), km, 13, 1793049300);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verify(km, 'snapshot-v1', raw, signature)).toBe(true);
    expect(verify(km, 'lease-v1', raw, signature)).toBe(false);
    expect(verify(km, 'snapshot-v1', Buffer.concat([raw, Buffer.from(' ')]), signature)).toBe(false);
  });

  it('hashes the content only: input order, version and time do not matter, any real change does', () => {
    const hash = contentHash(canonicalContent(data(), km));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(canonicalContent(reversed(), km))).toBe(hash);
    const a = encodeSnapshot(canonicalContent(data(), km), km, 1, 100);
    const b = encodeSnapshot(canonicalContent(reversed(), km), km, 1, 100);
    expect(a.raw.equals(b.raw)).toBe(true);
    expect(encodeSnapshot(canonicalContent(data(), km), km, 2, 200).raw.equals(a.raw)).toBe(false);

    const changes: ((d: SnapshotData) => void)[] = [
      (d) => (d.users[0].status = 'active'),
      (d) => (d.cards[0].status = 'active'),
      (d) => (d.schedules[1].end_minute = 700),
      (d) => (d.schedules[1].days_of_week = ['MONDAY']),
      (d) => (d.profiles[0].is_default = false),
      (d) => d.users.pop(),
      (d) => (d.keyVersion = 3),
    ];
    for (const change of changes) {
      const d = data();
      change(d);
      expect(contentHash(canonicalContent(d, km))).not.toBe(hash);
    }
  });

  it('maps weekdays to bits and rejects an unknown day', () => {
    expect(daysMask(['MONDAY', 'WEDNESDAY', 'FRIDAY'])).toBe(21);
    expect(daysMask(['MONDAY', 'MONDAY'])).toBe(1);
    expect(daysMask(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])).toBe(127);
    expect(() => daysMask(['FUNDAY'])).toThrow(/FUNDAY/);
  });

  it('refuses to encode a snapshot over the size limit', () => {
    const d = data();
    const name = 'x'.repeat(200);
    d.users = Array.from({ length: 5000 }, (_, i) => ({ id: id(100000 + i), external_id: `SV${i}`, full_name: name, status: 'active', group_ids: [] }));
    const content = canonicalContent(d, km);
    expect(JSON.stringify(content).length).toBeGreaterThan(SNAPSHOT_MAX_BYTES);
    expect(() => encodeSnapshot(content, km, 1, 1)).toThrow(SnapshotTooLargeError);
  });
});
