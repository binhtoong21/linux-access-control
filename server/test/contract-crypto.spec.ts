// Server must reproduce every value in contracts/vectors/crypto-v1.json byte for byte (same file as edge/tests).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blindIndex, cardMatchKey, deriveKm, InvalidUidError, newFetchCode, normalizeUid, sign, SIGNATURE_TAGS, SignatureTag, verify } from '../src/shared/crypto/crypto-v1';

const vectors = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'vectors', 'crypto-v1.json'), 'utf8'));
const master = Buffer.from(vectors.inputs.master_key_hex, 'hex');
const km = (id: string, v: number): Buffer =>
  Buffer.from(vectors.km.find((k: { mqtt_identity: string; key_version: number }) => k.mqtt_identity === id && k.key_version === v).km_hex, 'hex');

describe('crypto contract v1', () => {
  it('derives K_m', () => {
    for (const c of vectors.km) expect(deriveKm(master, c.mqtt_identity, c.key_version).toString('hex')).toBe(c.km_hex);
  });

  it('normalizes UIDs and rejects invalid ones', () => {
    for (const c of vectors.uid_normalize) expect(normalizeUid(c.raw)).toBe(c.normalized);
    for (const raw of vectors.uid_normalize_invalid) expect(() => normalizeUid(raw)).toThrow(InvalidUidError);
  });

  it('computes CardMatchKey and blind index', () => {
    for (const c of vectors.card_match_key) expect(cardMatchKey(km(c.mqtt_identity, c.key_version), c.uid)).toBe(c.match_key);
    const kIndex = Buffer.from(vectors.inputs.k_index_hex, 'hex');
    for (const c of vectors.blind_index) expect(blindIndex(kIndex, c.uid)).toBe(c.index);
  });

  it('signs and verifies raw payload bytes, detecting tampering and tag swaps', () => {
    for (const c of vectors.signatures) {
      const k = km(c.mqtt_identity, c.key_version);
      const payload = Buffer.from(c.payload_hex, 'hex');
      const tag = c.tag as SignatureTag;
      expect(sign(k, tag, payload)).toBe(c.signature);
      expect(verify(k, tag, payload, c.signature)).toBe(true);
      expect(verify(k, tag, Buffer.concat([payload, Buffer.from(' ')]), c.signature)).toBe(false);
      expect(verify(k, SIGNATURE_TAGS.find((t) => t !== tag)!, payload, c.signature)).toBe(false);
    }
  });

  it('issues fetch codes as 43-char base64url with a sha256 hash', () => {
    const { code, hash } = newFetchCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
