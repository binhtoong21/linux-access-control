import { hashPassword, verifyPassword } from '../../src/identity/password';

describe('password hashing', () => {
  it('hashes with Argon2id and verifies the right password only', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong password!!')).toBe(false);
  });

  it('returns false for a missing account', async () => {
    expect(await verifyPassword(null, 'timing-dummy-password')).toBe(false);
  });

  it('returns false instead of throwing on a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever123')).toBe(false);
  });
});
