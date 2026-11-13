import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KEY_ID_PATTERN } from '../../config';
import { blindIndex } from './crypto-v1';

// Server-side protection of card UIDs at rest (ADR-007, 11-operations/deployment.md): AES-256-GCM ciphertext
// plus an HMAC blind index. Keys are files in KEYS_DIR, 32 random bytes written as 64 hex characters, mode 0600:
//   uid-index.key         K_index of the blind index (not rotated in the MVP)
//   uid-enc-<key_id>.key  AES key; UID_ENC_KEY_ID picks the one for new rows, every file is loaded for decryption.

export const UID_INDEX_KEY_FILE = 'uid-index.key';
const ENC_KEY_FILE = /^uid-enc-([A-Za-z0-9_-]{1,32})\.key$/;
const KEY_HEX = /^[0-9a-fA-F]{64}$/;
const AAD = Buffer.from('uid-enc-v1');

export function encKeyFile(keyId: string): string {
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error(`invalid key id: ${keyId}`);
  return `uid-enc-${keyId}.key`;
}

/** VR-013 / D-021: a 4-byte UID whose first byte is 0x08 is a random ID that changes on every tap. */
export function isRandomUid(normalizedUid: string): boolean {
  return normalizedUid.length === 8 && normalizedUid.startsWith('08');
}

export interface EncryptedUid {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
}

export class UidVault {
  private readonly activeKey: Buffer;

  constructor(
    private readonly indexKey: Buffer,
    private readonly encKeys: ReadonlyMap<string, Buffer>,
    readonly activeKeyId: string,
  ) {
    if (indexKey.length !== 32) throw new Error('uid index key must be 32 bytes');
    for (const [id, key] of encKeys) {
      if (key.length !== 32) throw new Error(`uid encryption key ${id} must be 32 bytes`);
    }
    const active = encKeys.get(activeKeyId);
    if (!active) throw new Error(`uid encryption key ${activeKeyId} is not loaded`);
    this.activeKey = active;
  }

  /** Blind index of a normalized UID: uniqueness (INV-001), lookup by UID, audit correlation. */
  index(normalizedUid: string): string {
    return blindIndex(this.indexKey, normalizedUid);
  }

  encrypt(normalizedUid: string): EncryptedUid {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.activeKey, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(normalizedUid, 'ascii'), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: this.activeKeyId };
  }

  /** Throws when the key id is not loaded or the data was altered (GCM authentication fails). */
  decrypt(e: EncryptedUid): string {
    const key = this.encKeys.get(e.keyId);
    if (!key) throw new Error(`uid encryption key ${e.keyId} is not loaded`);
    const decipher = createDecipheriv('aes-256-gcm', key, e.iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(e.authTag);
    return Buffer.concat([decipher.update(e.ciphertext), decipher.final()]).toString('ascii');
  }
}

function readKeyFile(file: string): Buffer {
  // POSIX permission bits are meaningless on Windows (dev machines), so the check runs on Linux/macOS only.
  if (process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) {
    throw new Error(`${file} must not be accessible by group or others (chmod 600)`);
  }
  const hex = readFileSync(file, 'utf8').trim();
  if (!KEY_HEX.test(hex)) throw new Error(`${file} must contain 64 hex characters`);
  return Buffer.from(hex, 'hex');
}

/** Loads every UID key in keysDir. Called at startup so a missing key stops the server instead of the first card request. */
export function loadUidVault(keysDir: string, activeKeyId: string): UidVault {
  const dir = path.resolve(keysDir);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`KEYS_DIR ${dir} is not readable; create the keys with pnpm keys:init`);
  }
  if (!names.includes(UID_INDEX_KEY_FILE)) {
    throw new Error(`${path.join(dir, UID_INDEX_KEY_FILE)} is missing; create it with pnpm keys:init`);
  }
  const encKeys = new Map<string, Buffer>();
  for (const name of names) {
    const match = ENC_KEY_FILE.exec(name);
    if (match) encKeys.set(match[1], readKeyFile(path.join(dir, name)));
  }
  if (!encKeys.has(activeKeyId)) {
    throw new Error(`${path.join(dir, encKeyFile(activeKeyId))} is missing; create it with pnpm keys:init`);
  }
  return new UidVault(readKeyFile(path.join(dir, UID_INDEX_KEY_FILE)), encKeys, activeKeyId);
}

/** Creates the missing key files and returns their names. An existing key is never overwritten: losing it makes stored UIDs unreadable. */
export function initKeys(keysDir: string, activeKeyId: string): string[] {
  const dir = path.resolve(keysDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const created: string[] = [];
  for (const name of [UID_INDEX_KEY_FILE, encKeyFile(activeKeyId)]) {
    try {
      writeFileSync(path.join(dir, name), `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
      created.push(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  return created;
}
