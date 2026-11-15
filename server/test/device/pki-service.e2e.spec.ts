import * as x509 from '@peculiar/x509';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CERTIFICATE_AUTHORITY, PkiService } from '../../src/device/pki.service';
import { CertificateAuthority } from '../../src/shared/crypto/pki';
import { ApiContext, startSignedIn } from '../support/api';
import { kyselyOn, TEST_DATABASE_URL } from '../support/db';
import { testKeysDir } from '../support/keys';

interface Health {
  crl_next_update: string | null;
  warnings: string[];
}

const DAY_MS = 86_400_000;

(TEST_DATABASE_URL ? describe : describe.skip)('PKI service', () => {
  let api: ApiContext;
  let pki: PkiService;
  const crlFile = path.join(testKeysDir(), 'crl.pem');
  const serials = (): string[] => new x509.X509Crl(readFileSync(crlFile, 'utf8')).entries.map((e) => e.serialNumber.toLowerCase());
  const health = async (): Promise<Health> => (await (await api.call('GET', '/system/health')).json()) as Health;
  const revoke = async (serial: string, reason: string): Promise<void> => {
    const ws = await api.pool.query(
      `INSERT INTO workstations (mqtt_identity, machine_id, mac_address, hostname, public_key)
       VALUES ($1, $1, $2, $1, 'pk') RETURNING id`,
      [`ws-${serial.slice(0, 6)}`, `02:00:00:00:00:${serial.slice(0, 2)}`],
    );
    await api.pool.query('INSERT INTO revoked_certificates (cert_serial, workstation_id, reason) VALUES ($1, $2, $3)', [serial, ws.rows[0].id, reason]);
  };

  beforeAll(async () => {
    rmSync(crlFile, { force: true });
    api = await startSignedIn(TEST_DATABASE_URL as string);
    pki = api.ctx.app.get(PkiService, { strict: false });
  });
  afterAll(async () => api.close());

  it('writes an empty CRL at startup and reports its expiry in the health check', async () => {
    expect(existsSync(crlFile)).toBe(true);
    expect(readFileSync(crlFile, 'utf8').startsWith('-----BEGIN X509 CRL-----')).toBe(true);
    expect(serials()).toEqual([]);
    const report = await health();
    const next = new Date(report.crl_next_update as string).getTime();
    expect(next - Date.now()).toBeGreaterThan(3600 * DAY_MS);
    expect(report.warnings).toEqual([]);
  });

  it('lists every revoked serial after a revocation; without a restart command the broker is not restarted', async () => {
    await revoke('41aa0000000000000000000000000001', 'reinstalled');
    expect(serials()).toEqual([]);
    expect(await pki.revocationChanged()).toEqual({ brokerRestarted: false });
    expect(serials()).toEqual(['41aa0000000000000000000000000001']);
    await revoke('42bb0000000000000000000000000002', 'disabled');
    await pki.publishCrl();
    expect(serials().sort()).toEqual(['41aa0000000000000000000000000001', '42bb0000000000000000000000000002']);
  });

  it('runs the broker restart command after writing the CRL and survives a failing command', async () => {
    const ca = api.ctx.app.get<CertificateAuthority>(CERTIFICATE_AUTHORITY, { strict: false });
    const db = kyselyOn(api.pool);
    const marker = path.join(testKeysDir(), 'broker-restarted').replace(/\\/g, '/');
    rmSync(marker, { force: true });
    const ok = new PkiService(ca, db, { crlFile, brokerRestartCmd: `node -e "require('fs').writeFileSync('${marker}', 'x')"` });
    expect(await ok.revocationChanged()).toEqual({ brokerRestarted: true });
    expect(existsSync(marker)).toBe(true);
    const failing = new PkiService(ca, db, { crlFile, brokerRestartCmd: 'node -e "process.exit(3)"' });
    expect(await failing.revocationChanged()).toEqual({ brokerRestarted: false });
    expect(serials()).toHaveLength(2);
  });

  it('warns when the CRL expires within 30 days', async () => {
    const spy = jest.spyOn(pki, 'crlNextUpdate').mockReturnValue(new Date(Date.now() + 10 * DAY_MS));
    expect((await health()).warnings).toEqual(['crl_expiring']);
    spy.mockReturnValue(new Date(Date.now() + 40 * DAY_MS));
    expect((await health()).warnings).toEqual([]);
    spy.mockRestore();
  });
});
