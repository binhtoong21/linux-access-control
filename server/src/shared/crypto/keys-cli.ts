import { loadKeyConfig } from '../../config';
import { initKeys } from './uid-vault';

// pnpm keys:init: creates the missing UID key files in KEYS_DIR (11-operations/deployment.md). Prints file names, never key material.
function main(): void {
  const { keysDir, uidEncKeyId } = loadKeyConfig();
  const created = initKeys(keysDir, uidEncKeyId);
  console.log(created.length ? `created in ${keysDir}: ${created.join(', ')}` : `all keys already exist in ${keysDir}; nothing changed`);
}

try {
  main();
} catch (err) {
  console.error(`keys:init failed: ${(err as Error).message}`);
  process.exit(1);
}
