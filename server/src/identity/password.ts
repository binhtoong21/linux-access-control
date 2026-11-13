import { hash, verify } from '@node-rs/argon2';

// NFR-SEC06. @node-rs/argon2 defaults to Argon2id, m = 19456 KiB, t = 2, p = 1 (OWASP minimum profile).
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let timingDummy: Promise<string> | undefined;

/**
 * Verifies `password` against `stored`. With `stored = null` (unknown or disabled account) it still runs one
 * verification against a dummy hash and returns false, so response time does not reveal which usernames exist.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  const target = stored ?? (await (timingDummy ??= hashPassword('timing-dummy-password')));
  const ok = await verify(target, password).catch(() => false);
  return stored !== null && ok;
}
