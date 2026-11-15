import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { createPrivateKey, randomBytes, webcrypto } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

// Workstation PKI (ADR-002 §7, D-014): the server signs one client certificate per workstation (CN = mqtt_identity)
// and publishes the revoked serials as a CRL file read by Mosquitto. Library use verified in spikes S8 and S9.
x509.cryptoProvider.set(webcrypto as never);

/** "Bảng Tham Số": workstation certificates live 3 years. */
export const CLIENT_CERT_DAYS = 1095;
/** S9: an expired CRL makes the broker refuse every client, so it is signed for 10 years and regenerated daily. */
export const CRL_DAYS = 3650;
export const MQTT_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

const CLIENT_AUTH_OID = '1.3.6.1.5.5.7.3.2';
const CA_SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY_MS = 86_400_000;
const BACKDATE_MS = 5 * 60_000;

export class InvalidCsrError extends Error {}

export interface ParsedCsr {
  request: x509.Pkcs10CertificateRequest;
  /** SPKI PEM of the workstation's public key (workstations.public_key). */
  publicKeyPem: string;
}

export interface IssuedCertificate {
  pem: string;
  /** 32 lowercase hex characters; the key of revoked_certificates. */
  serial: string;
  expiresAt: Date;
}

export interface RevokedCertificate {
  serial: string;
  revokedAt: Date;
  reason: 'reinstalled' | 'disabled';
}

export interface SignedCrl {
  pem: string;
  nextUpdate: Date;
}

/** Only an Ed25519 request whose signature proves possession of the key is accepted (api.md INVALID_CSR). */
export async function parseCsr(csrPem: string): Promise<ParsedCsr> {
  let request: x509.Pkcs10CertificateRequest;
  try {
    request = new x509.Pkcs10CertificateRequest(csrPem);
  } catch {
    throw new InvalidCsrError('CSR is not a PKCS#10 request');
  }
  if (request.publicKey.algorithm.name !== 'Ed25519') throw new InvalidCsrError('CSR key must be Ed25519');
  let valid = false;
  try {
    valid = await request.verify();
  } catch {
    valid = false;
  }
  if (!valid) throw new InvalidCsrError('CSR signature is invalid');
  return { request, publicKeyPem: request.publicKey.toString('pem') };
}

// Positive, fixed length: the top bits are forced to 01 so DER never drops or pads a byte.
function newSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] = (bytes[0] & 0x3f) | 0x40;
  return bytes.toString('hex');
}

const toPem = (label: string, der: ArrayBuffer): string =>
  `-----BEGIN ${label}-----\n${(Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;

export class CertificateAuthority {
  private constructor(
    private readonly certificate: x509.X509Certificate,
    private readonly signingKey: webcrypto.CryptoKey,
  ) {}

  /** The CA key is EC P-256, as created by deploy scripts (`openssl ecparam -name prime256v1`). */
  static async load(certFile: string, keyFile: string): Promise<CertificateAuthority> {
    const certificate = new x509.X509Certificate(readFileSync(certFile, 'utf8'));
    const key = createPrivateKey(readFileSync(keyFile, 'utf8'));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error(`${keyFile} must be an EC P-256 private key`);
    }
    const signingKey = await webcrypto.subtle.importKey(
      'pkcs8',
      key.export({ type: 'pkcs8', format: 'der' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return new CertificateAuthority(certificate, signingKey);
  }

  get certificatePem(): string {
    return this.certificate.toString('pem');
  }

  /** Client certificate for mTLS with the broker; the broker takes the CN as the MQTT username (ADR-002 §1). */
  async issue(csrPem: string, commonName: string, now: Date = new Date()): Promise<IssuedCertificate> {
    if (!MQTT_IDENTITY_PATTERN.test(commonName)) throw new Error(`invalid common name: ${commonName}`);
    const { request } = await parseCsr(csrPem);
    const serial = newSerial();
    const certificate = await x509.X509CertificateGenerator.create({
      serialNumber: serial,
      subject: `CN=${commonName}`,
      issuer: this.certificate.subject,
      notBefore: new Date(now.getTime() - BACKDATE_MS),
      notAfter: new Date(now.getTime() + CLIENT_CERT_DAYS * DAY_MS),
      signingAlgorithm: CA_SIGNING,
      publicKey: request.publicKey,
      signingKey: this.signingKey as never,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension([CLIENT_AUTH_OID], true),
      ],
    });
    return { pem: certificate.toString('pem'), serial, expiresAt: certificate.notAfter };
  }

  /** The full list of revoked serials, signed. An empty list is a valid CRL and must still be written (S9). */
  async crl(revoked: RevokedCertificate[], now: Date = new Date()): Promise<SignedCrl> {
    const nextUpdate = new Date(now.getTime() + CRL_DAYS * DAY_MS);
    const crl = await x509.X509CrlGenerator.create({
      issuer: this.certificate.subject,
      thisUpdate: now,
      nextUpdate,
      entries: revoked.map((r) => ({
        serialNumber: r.serial,
        revocationDate: r.revokedAt,
        reason: r.reason === 'reinstalled' ? x509.X509CrlReason.superseded : x509.X509CrlReason.cessationOfOperation,
      })),
      signingAlgorithm: CA_SIGNING,
      signingKey: this.signingKey as never,
    });
    // The library labels the PEM "CRL"; OpenSSL and Mosquitto only read "X509 CRL".
    return { pem: toPem('X509 CRL', crl.rawData), nextUpdate };
  }
}

/** Temp file in the same directory, then rename: readers see the old or the new content, never a partial file. */
export function writeFileAtomic(file: string, content: string, mode = 0o644): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, file);
}
