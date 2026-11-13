import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadKeyConfig } from '../../src/config';
import { blindIndex } from '../../src/shared/crypto/crypto-v1';
import { encKeyFile, initKeys, isRandomUid, loadUidVault, UID_INDEX_KEY_FILE, UidVault } from '../../src/shared/crypto/uid-vault';

const key = (byte: number) => Buffer.alloc(32, byte);
const vault = (active = 'k1') => new UidVault(key(1), new Map([['k1', key(2)], ['k2', key(3)]]), active);

describe('UidVault', () => {
  it('round-trips a UID with a fresh IV each time', () => {
    const v = vault();
    const a = v.encrypt('1F0820CF');
    const b = v.encrypt('1F0820CF');
    expect(a.iv).toHaveLength(12);
    expect(a.authTag).toHaveLength(16);
    expect(a.keyId).toBe('k1');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(v.decrypt(a)).toBe('1F0820CF');
  });

  it('rejects altered ciphertext or tag', () => {
    const v = vault();
    const e = v.encrypt('04A1B2C3D4E5F6');
    const flipped = Buffer.from(e.ciphertext);
    flipped[0] ^= 1;
    expect(() => v.decrypt({ ...e, ciphertext: flipped })).toThrow();
    const tag = Buffer.from(e.authTag);
    tag[0] ^= 1;
    expect(() => v.decrypt({ ...e, authTag: tag })).toThrow();
  });

  it('decrypts rows of an older key after rotation and rejects unknown key ids', () => {
    const old = vault('k1').encrypt('1F0820CF');
    const rotated = vault('k2');
    expect(rotated.encrypt('1F0820CF').keyId).toBe('k2');
    expect(rotated.decrypt(old)).toBe('1F0820CF');
    expect(() => rotated.decrypt({ ...old, keyId: 'k9' })).toThrow(/k9/);
  });

  it('uses the crypto-v1 blind index with K_index', () => {
    expect(vault().index('1F0820CF')).toBe(blindIndex(key(1), '1F0820CF'));
  });

  it('refuses wrong key sizes and a missing active key', () => {
    expect(() => new UidVault(Buffer.alloc(16), new Map([['k1', key(2)]]), 'k1')).toThrow();
    expect(() => new UidVault(key(1), new Map([['k1', Buffer.alloc(31)]]), 'k1')).toThrow();
    expect(() => new UidVault(key(1), new Map([['k1', key(2)]]), 'k2')).toThrow(/k2/);
  });
});

describe('isRandomUid (VR-013)', () => {
  it('flags only 4-byte UIDs starting with 08', () => {
    expect(isRandomUid('08A1B2C3')).toBe(true);
    expect(isRandomUid('1F0820CF')).toBe(false);
    expect(isRandomUid('08A1B2C3D4E5F6')).toBe(false);
  });
});

describe('key files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nfc-keys-spec-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('initKeys creates missing files once and never overwrites', () => {
    const keysDir = path.join(dir, 'keys');
    expect(initKeys(keysDir, 'k1')).toEqual([UID_INDEX_KEY_FILE, 'uid-enc-k1.key']);
    const before = readFileSync(path.join(keysDir, UID_INDEX_KEY_FILE), 'utf8');
    expect(before.trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(initKeys(keysDir, 'k1')).toEqual([]);
    expect(readFileSync(path.join(keysDir, UID_INDEX_KEY_FILE), 'utf8')).toBe(before);
    expect(initKeys(keysDir, 'k2')).toEqual(['uid-enc-k2.key']);
  });

  it('loadUidVault loads every encryption key and encrypts with the active one', () => {
    initKeys(dir, 'k1');
    const old = loadUidVault(dir, 'k1').encrypt('1F0820CF');
    initKeys(dir, 'k2');
    const v = loadUidVault(dir, 'k2');
    expect(v.activeKeyId).toBe('k2');
    expect(v.decrypt(old)).toBe('1F0820CF');
  });

  it('fails fast on a missing directory, index key, active key or bad key content', () => {
    expect(() => loadUidVault(path.join(dir, 'nope'), 'k1')).toThrow(/keys:init/);
    initKeys(dir, 'k1');
    expect(() => loadUidVault(dir, 'k2')).toThrow(/uid-enc-k2\.key is missing/);
    writeFileSync(path.join(dir, encKeyFile('k1')), 'not-hex\n', { mode: 0o600 });
    expect(() => loadUidVault(dir, 'k1')).toThrow(/64 hex characters/);
    rmSync(path.join(dir, UID_INDEX_KEY_FILE));
    expect(() => loadUidVault(dir, 'k1')).toThrow(/uid-index\.key is missing/);
  });

  (process.platform === 'win32' ? it.skip : it)('refuses key files readable by group or others', () => {
    initKeys(dir, 'k1');
    chmodSync(path.join(dir, UID_INDEX_KEY_FILE), 0o644);
    expect(() => loadUidVault(dir, 'k1')).toThrow(/chmod 600/);
  });

  it('rejects key ids that could escape the directory', () => {
    expect(() => encKeyFile('../x')).toThrow();
  });
});

describe('key config', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost/db', JWT_SECRET: 'x'.repeat(32) };

  it('defaults KEYS_DIR and UID_ENC_KEY_ID', () => {
    expect(loadConfig(base)).toMatchObject({ keysDir: '/etc/nfc-server/keys', uidEncKeyId: 'k1' });
    expect(loadKeyConfig({})).toEqual({ keysDir: '/etc/nfc-server/keys', uidEncKeyId: 'k1' });
  });

  it('rejects an invalid UID_ENC_KEY_ID', () => {
    expect(() => loadConfig({ ...base, UID_ENC_KEY_ID: 'a/b' })).toThrow(/UID_ENC_KEY_ID/);
    expect(() => loadKeyConfig({ UID_ENC_KEY_ID: 'a/b' })).toThrow(/UID_ENC_KEY_ID/);
  });
});
