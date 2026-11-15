import * as x509 from '@peculiar/x509';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CertificateAuthority, CLIENT_CERT_DAYS, CRL_DAYS, InvalidCsrError, parseCsr, writeFileAtomic } from '../../src/shared/crypto/pki';
import { makeCsr, makeTestCa, tamperCsr } from '../support/pki';

const DAY_MS = 86_400_000;

describe('workstation PKI', () => {
  let dir: string;
  let ca: CertificateAuthority;
  let caCert: X509Certificate;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nfc-pki-'));
    const files = await makeTestCa(dir);
    ca = await CertificateAuthority.load(files.certFile, files.keyFile);
    caCert = new X509Certificate(readFileSync(files.certFile));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts an Ed25519 request and exposes its public key', async () => {
    const parsed = await parseCsr(await makeCsr());
    expect(parsed.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(parsed.request.publicKey.algorithm.name).toBe('Ed25519');
  });

  it('rejects garbage, other key types and a request whose signature does not match (INVALID_CSR)', async () => {
    const bad = [
      'not a csr',
      '-----BEGIN CERTIFICATE REQUEST-----\nAAAA\n-----END CERTIFICATE REQUEST-----',
      await makeCsr('rsa'),
      await makeCsr('p256'),
      tamperCsr(await makeCsr()),
    ];
    for (const csr of bad) await expect(parseCsr(csr)).rejects.toBeInstanceOf(InvalidCsrError);
    await expect(ca.issue(await makeCsr('rsa'), 'ws-01')).rejects.toBeInstanceOf(InvalidCsrError);
  });

  it('issues a three-year client certificate for the given name, signed by the CA', async () => {
    const now = new Date('2026-11-15T00:00:00Z');
    const issued = await ca.issue(await makeCsr(), 'ws-01', now);
    const cert = new X509Certificate(issued.pem);
    expect(cert.subject).toBe('CN=ws-01');
    expect(cert.checkIssued(caCert)).toBe(true);
    expect(cert.verify(caCert.publicKey)).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.2']);
    expect(cert.publicKey.asymmetricKeyType).toBe('ed25519');
    expect(issued.serial).toMatch(/^[4-7][0-9a-f]{31}$/);
    expect(cert.serialNumber.toLowerCase()).toBe(issued.serial);
    expect(issued.expiresAt.getTime()).toBe(now.getTime() + CLIENT_CERT_DAYS * DAY_MS);
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(now.getTime());
    const other = await ca.issue(await makeCsr(), 'ws-01', now);
    expect(other.serial).not.toBe(issued.serial);
  });

  it('refuses a common name that is not a valid mqtt identity', async () => {
    const csr = await makeCsr();
    for (const name of ['ab', 'ws 01', 'ws/01', 'CN=evil,O=x', '']) await expect(ca.issue(csr, name)).rejects.toThrow(/invalid common name/);
  });

  it('signs a CRL that OpenSSL can read, listing the revoked serials', async () => {
    const now = new Date('2026-11-15T00:00:00Z');
    const a = await ca.issue(await makeCsr(), 'ws-01', now);
    const b = await ca.issue(await makeCsr(), 'ws-02', now);
    const signed = await ca.crl(
      [
        { serial: a.serial, revokedAt: now, reason: 'reinstalled' },
        { serial: b.serial, revokedAt: now, reason: 'disabled' },
      ],
      now,
    );
    expect(signed.pem.startsWith('-----BEGIN X509 CRL-----\n')).toBe(true);
    expect(signed.pem.trimEnd().endsWith('-----END X509 CRL-----')).toBe(true);
    expect(signed.nextUpdate.getTime()).toBe(now.getTime() + CRL_DAYS * DAY_MS);
    const crl = new x509.X509Crl(signed.pem);
    expect(crl.entries.map((e) => e.serialNumber.toLowerCase()).sort()).toEqual([a.serial, b.serial].sort());
    expect(await crl.verify({ publicKey: new x509.X509Certificate(ca.certificatePem) })).toBe(true);
    expect(crl.nextUpdate?.getTime()).toBe(signed.nextUpdate.getTime());

    const empty = new x509.X509Crl((await ca.crl([], now)).pem);
    expect(empty.entries).toHaveLength(0);
  });

  it('refuses a CA key that is not EC P-256', async () => {
    const keyFile = path.join(dir, 'bad.key');
    writeFileSync(keyFile, 'not a key');
    await expect(CertificateAuthority.load(path.join(dir, 'ca.crt'), keyFile)).rejects.toThrow();
  });

  it('writes files through a temp file and leaves none behind', () => {
    const file = path.join(dir, 'crl.pem');
    writeFileAtomic(file, 'one');
    writeFileAtomic(file, 'two');
    expect(readFileSync(file, 'utf8')).toBe('two');
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

