import { generateKeyPairSync, sign } from 'node:crypto';

// Ephemeral self-signed test CA: no committed private key or external openssl.
export function testCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = (tag: number, ...values: Buffer[]) => {
    const data = Buffer.concat(values), n = data.length;
    const length = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
    return Buffer.concat([Buffer.from([tag]), length, data]);
  };
  const seq = (...v: Buffer[]) => der(0x30, ...v), oid = (hex: string) => der(6, Buffer.from(hex, 'hex'));
  const algorithm = seq(oid('2a864886f70d01010b'), der(5));
  const name = seq(der(0x31, seq(oid('550403'), der(12, Buffer.from('YAPLIX ephemeral test CA')))));
  const ext = der(0xa3, seq(
    seq(oid('551d13'), der(1, Buffer.from([255])), der(4, seq(der(1, Buffer.from([255]))))),
    seq(oid('551d11'), der(4, seq(...['localhost', 'ollama.com', 'openrouter.ai'].map(x => der(0x82, Buffer.from(x))), der(0x87, Buffer.from([127, 0, 0, 1])))))
  ));
  const tbs = seq(der(0xa0, der(2, Buffer.from([2]))), der(2, Buffer.from([1])), algorithm, name,
    seq(der(24, Buffer.from('20200101000000Z')), der(24, Buffer.from('20400101000000Z'))), name,
    publicKey.export({ type: 'spki', format: 'der' }), ext);
  const cert = seq(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, privateKey)));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: '-----BEGIN CERTIFICATE-----\n' + cert.toString('base64').match(/.{1,64}/g)!.join('\n') + '\n-----END CERTIFICATE-----\n' };
}
