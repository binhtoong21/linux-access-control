import { Logger } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PkiService } from '../../src/device/pki.service';
import { Db } from '../../src/infra/database/database.module';
import { CertificateAuthority } from '../../src/shared/crypto/pki';
import { kyselyOn } from '../support/db';
import { ensureTestCa, testKeysDir } from '../support/keys';
import { makeTestCa } from '../support/pki';

describe('PKI CRL carry-over', () => {
  let ca: CertificateAuthority;
  let dir: string;
  let crlFile: string;
  let db: Db;
  let pool: Pool;
  let services: PkiService[];
  const carriedSerial = '41aa0000000000000000000000000001';
  const dbSerial = '42bb0000000000000000000000000002';
  const dbOnlySerial = '43cc0000000000000000000000000003';
  const oldDate = new Date('2026-10-01T00:00:00Z');
  const dbDate = new Date('2026-11-01T00:00:00Z');
  const readCrl = (): x509.X509Crl => new x509.X509Crl(readFileSync(crlFile, 'utf8'));
  const service = (): PkiService => {
    const pki = new PkiService(ca, db, { crlFile, brokerRestartCmd: '' });
    services.push(pki);
    return pki;
  };

  beforeAll(async () => {
    const keysDir = await ensureTestCa();
    ca = await CertificateAuthority.load(path.join(keysDir, 'ca.crt'), path.join(keysDir, 'ca.key'));
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(testKeysDir(), 'crl-carry-'));
    crlFile = path.join(dir, 'crl.pem');
    services = [];
    pool = new Pool();
    db = kyselyOn(pool);
    // Exercise real Kysely query compilation without opening a database connection.
    jest.spyOn(db.getExecutor(), 'executeQuery').mockResolvedValue({ rows: [] });
  });

  afterEach(async () => {
    services.forEach((pki) => pki.onApplicationShutdown());
    jest.restoreAllMocks();
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the union across publishes and restarts, with DB dates and reasons winning duplicate serials', async () => {
    writeFileSync(crlFile, (await ca.crl([
      { serial: carriedSerial.toUpperCase(), revokedAt: oldDate, reason: x509.X509CrlReason.keyCompromise },
      { serial: dbSerial.toUpperCase(), revokedAt: oldDate, reason: 'reinstalled' },
    ])).pem);
    jest.spyOn(db.getExecutor(), 'executeQuery').mockResolvedValue({
      rows: [
        { cert_serial: dbSerial, revoked_at: dbDate, reason: 'disabled' },
        { cert_serial: dbOnlySerial, revoked_at: dbDate, reason: 'reinstalled' },
      ],
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const pki = service();
    await pki.onApplicationBootstrap();
    await pki.publishCrl();
    const entries = readCrl().entries;
    expect(entries.map((entry) => entry.serialNumber.toLowerCase()).sort()).toEqual([carriedSerial, dbSerial, dbOnlySerial]);
    expect(entries[0].revocationDate).toEqual(oldDate);
    expect(entries[0].reason).toBe(x509.X509CrlReason.keyCompromise);
    expect(entries[1].revocationDate).toEqual(dbDate);
    expect(entries[1].reason).toBe(x509.X509CrlReason.cessationOfOperation);
    expect(entries[2].revocationDate).toEqual(dbDate);
    expect(entries[2].reason).toBe(x509.X509CrlReason.superseded);
    expect(await readCrl().verify({ publicKey: new x509.X509Certificate(ca.certificatePem).publicKey })).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('1 revoked certificate(s) kept from the existing CRL that the database does not know');

    pki.onApplicationShutdown();
    jest.spyOn(db.getExecutor(), 'executeQuery').mockResolvedValue({ rows: [] });
    const restarted = service();
    await restarted.onApplicationBootstrap();
    await restarted.publishCrl();
    expect(readCrl().entries.map((entry) => entry.serialNumber.toLowerCase()).sort()).toEqual([carriedSerial, dbSerial, dbOnlySerial]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('3 revoked certificate(s) kept from the existing CRL that the database does not know');
  });

  it.each([undefined, x509.X509CrlReason.unspecified])('preserves an entry with reason %s', async (reason) => {
    writeFileSync(crlFile, (await ca.crl([{ serial: carriedSerial, revokedAt: oldDate, reason }])).pem);
    expect(readCrl().entries[0].reason).toBe(reason);
    await service().onApplicationBootstrap();
    expect(readCrl().entries).toHaveLength(1);
    expect(readCrl().entries[0].reason).toBe(reason);
    expect(readCrl().entries[0].revocationDate).toEqual(oldDate);
  });

  it('ignores a CRL signed by another CA even with the same issuer name, warns and continues startup', async () => {
    const foreignDir = path.join(dir, 'foreign');
    mkdirSync(foreignDir);
    const files = await makeTestCa(foreignDir);
    const foreignCa = await CertificateAuthority.load(files.certFile, files.keyFile);
    writeFileSync(crlFile, (await foreignCa.crl([{ serial: carriedSerial, revokedAt: oldDate, reason: 'disabled' }])).pem);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service().onApplicationBootstrap()).resolves.toBeUndefined();
    expect(readCrl().entries).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CRL signature does not match our CA'));
  });

  it.each(['malformed', 'unreadable'])('warns and continues startup for an %s existing CRL', async (kind) => {
    if (kind === 'malformed') writeFileSync(crlFile, 'not a CRL');
    else mkdirSync(crlFile);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pki = service();
    await expect(pki.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Existing CRL ignored:'));
    // Remove the directory blocking the output, then confirm publication still works.
    if (kind === 'unreadable') rmSync(crlFile, { recursive: true });
    await pki.publishCrl();
    expect(readCrl().entries).toEqual([]);
    error.mockRestore();
  });

  it('creates an empty CRL normally when no file exists', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await service().onApplicationBootstrap();
    expect(readCrl().entries).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
