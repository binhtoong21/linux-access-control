import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { generateKeyPairSync, KeyObject, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

x509.cryptoProvider.set(webcrypto as never);

const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ED = { name: 'Ed25519' } as const;

async function importPair(
  keys: { privateKey: KeyObject; publicKey: KeyObject },
  algorithm: typeof EC | typeof ED,
): Promise<{ privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey }> {
  return {
    privateKey: await webcrypto.subtle.importKey('pkcs8', keys.privateKey.export({ type: 'pkcs8', format: 'der' }), algorithm, false, ['sign']),
    publicKey: await webcrypto.subtle.importKey('spki', keys.publicKey.export({ type: 'spki', format: 'der' }), algorithm, true, ['verify']),
  };
}

/** Writes a throwaway CA (EC P-256, SEC1 key like `openssl ecparam`) as ca.crt / ca.key into `dir`. */
export async function makeTestCa(dir: string): Promise<{ certFile: string; keyFile: string }> {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pair = await importPair(keys, EC);
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: '01',
    subject: 'CN=NFC Lab Test CA',
    issuer: 'CN=NFC Lab Test CA',
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 3650 * 86_400_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    publicKey: pair.publicKey as never,
    signingKey: pair.privateKey as never,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
    ],
  });
  const certFile = path.join(dir, 'ca.crt');
  const keyFile = path.join(dir, 'ca.key');
  writeFileSync(certFile, cert.toString('pem'));
  writeFileSync(keyFile, keys.privateKey.export({ type: 'sec1', format: 'pem' }), { mode: 0o600 });
  return { certFile, keyFile };
}

/** A certificate signing request the way a workstation makes one (Ed25519), or with another key type for negative tests. */
export async function makeCsr(kind: 'ed25519' | 'p256' | 'rsa' = 'ed25519', commonName = 'ws-temp'): Promise<string> {
  if (kind === 'rsa') {
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${commonName}`,
      keys: keys as never,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    });
    return csr.toString('pem');
  }
  if (kind === 'p256') {
    const keys = await importPair(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), EC);
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: `CN=${commonName}`,
      keys: keys as never,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    });
    return csr.toString('pem');
  }
  const keys = await importPair(generateKeyPairSync('ed25519'), ED);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({ name: `CN=${commonName}`, keys: keys as never, signingAlgorithm: ED });
  return csr.toString('pem');
}

/** The same request with one byte of its body changed, so its signature no longer matches. */
export function tamperCsr(csrPem: string, commonName = 'ws-temp'): string {
  const der = Buffer.from(new x509.Pkcs10CertificateRequest(csrPem).rawData);
  const at = der.indexOf(commonName);
  der[at] = der[at] ^ 1;
  const body = (der.toString('base64').match(/.{1,64}/g) ?? []).join('\n');
  return `-----BEGIN CERTIFICATE REQUEST-----\n${body}\n-----END CERTIFICATE REQUEST-----\n`;
}
