import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initKeys } from '../../src/shared/crypto/uid-vault';
import { makeTestCa } from './pki';

let dir: string | undefined;

/** One throwaway key directory per test process: UID keys and the master key. */
export function testKeysDir(): string {
  if (!dir) {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nfc-keys-'));
    initKeys(dir, 'k1');
  }
  return dir;
}

/** Adds a throwaway CA (ca.crt, ca.key) to the test key directory once; the app refuses to start without one. */
export async function ensureTestCa(): Promise<string> {
  const keysDir = testKeysDir();
  if (!existsSync(path.join(keysDir, 'ca.crt'))) await makeTestCa(keysDir);
  return keysDir;
}
