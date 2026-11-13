import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initKeys } from '../../src/shared/crypto/uid-vault';

let dir: string | undefined;

/** One throwaway UID key directory per test process. */
export function testKeysDir(): string {
  if (!dir) {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nfc-keys-'));
    initKeys(dir, 'k1');
  }
  return dir;
}
