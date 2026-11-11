// Crypto contract v1 (contracts/README.md). Byte-exact with edge/nfc_agent/infra/crypto.py.
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const KM_SALT = 'nfc-lab-km-v1';
export const SIGNATURE_TAGS = ['snapshot-v1', 'lease-v1', 'ack-v1'] as const;
export type SignatureTag = (typeof SIGNATURE_TAGS)[number];

const VALID_UID_BYTES = new Set([4, 7, 10]);

export class InvalidUidError extends Error {}

/** K_m = HKDF-SHA256(master_key, salt = KM_SALT, info = "<mqtt_identity>:<key_version>") (ADR-007). */
export function deriveKm(masterKey: Buffer, mqttIdentity: string, keyVersion: number): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(KM_SALT), Buffer.from(`${mqttIdentity}:${keyVersion}`), 32));
}

/** Uppercase hex, separators removed, byte order kept; 4, 7 or 10 bytes (VR-007). */
export function normalizeUid(raw: string): string {
  const uid = raw.replace(/[:\s-]/g, '').toUpperCase();
  if (uid.length % 2 !== 0 || !VALID_UID_BYTES.has(uid.length / 2) || !/^[0-9A-F]+$/.test(uid)) {
    throw new InvalidUidError(`UID must be 4, 7 or 10 bytes of hex: ${raw}`);
  }
  return uid;
}

export function cardMatchKey(km: Buffer, normalizedUid: string): string {
  return createHmac('sha256', km).update(Buffer.concat([Buffer.from('uid-match-v1'), Buffer.from(normalizedUid, 'ascii')])).digest('hex');
}

/** Server-side blind index for uniqueness and lookup (ADR-007), keyed by K_index. */
export function blindIndex(kIndex: Buffer, normalizedUid: string): string {
  return createHmac('sha256', kIndex).update(Buffer.concat([Buffer.from('uid-index-v1'), Buffer.from(normalizedUid, 'ascii')])).digest('hex');
}

/** Sign the exact bytes that will be published (ADR-003 §4). */
export function sign(km: Buffer, tag: SignatureTag, payload: Buffer): string {
  return createHmac('sha256', km).update(Buffer.concat([Buffer.from(`${tag}:`), payload])).digest('hex');
}

export function verify(km: Buffer, tag: SignatureTag, payload: Buffer, signature: string): boolean {
  const expected = Buffer.from(sign(km, tag, payload), 'hex');
  const given = Buffer.from(signature.toLowerCase(), 'hex');
  return given.length === expected.length && timingSafeEqual(expected, given);
}

/** One-time enrollment fetch code: 32 random bytes base64url; only its SHA-256 hex is stored (D-014). */
export function newFetchCode(): { code: string; hash: string } {
  const code = randomBytes(32).toString('base64url');
  return { code, hash: createHash('sha256').update(code).digest('hex') };
}
