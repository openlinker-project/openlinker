/**
 * Test-only XAdES Enveloped-Signature Signer
 *
 * A self-contained, dependency-free XAdES-style enveloped-signature signer used
 * ONLY by `*.spec.ts` to exercise the qualified-seal auth shape with a generated
 * self-signed test certificate. It is intentionally NOT the production signer:
 * the production `KsefAuthXmlBuilder.signXades` stub stays deferred to C4 (real
 * X.509/HSM material + a vetted XML-DSig library), per its documented intent.
 *
 * What this fixture proves at unit level:
 *  - the (token | timestamp | challenge) AuthTokenRequest envelope can be signed
 *    with an RSA private key (RSA-SHA256) tied to a self-signed cert;
 *  - the resulting document embeds the signature value + the X.509 cert;
 *  - the signature verifies against the cert's public key (round-trip), so a
 *    future real signer has a known-good reference shape and a verify helper.
 *
 * Canonicalization is a simplified, deterministic byte serialization of the
 * signed element (NOT W3C C14N) — sufficient for a sign/verify round-trip in a
 * test, but explicitly not interop-grade. Do not promote this to production.
 *
 * SECURITY: test-only. Never imported from runtime code; never holds real keys.
 *
 * @module libs/integrations/ksef/src/testing
 */
import {
  createSign,
  createVerify,
  generateKeyPairSync,
  type KeyObject,
} from 'crypto';

const RSA_SHA256_ALG = 'RSA-SHA256';

/** A generated self-signed-style RSA key pair + its SPKI/PKCS8 PEMs for tests. */
export interface TestSigningMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Base64 DER of the SPKI, stamped into the envelope as a stand-in X509Certificate. */
  certificateB64: string;
}

/** Generate an RSA-2048 key pair for the XAdES test signer. */
export function generateTestSigningMaterial(): TestSigningMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const certificateB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { privateKeyPem, publicKeyPem, privateKey, publicKey, certificateB64 };
}

/**
 * Produce the byte string that is signed — the unsigned envelope as UTF-8. In a
 * real XAdES signer this is the C14N of the referenced element; here it is the
 * exact envelope string, which is deterministic and round-trippable.
 */
function canonicalizeForSigning(unsignedXml: string): Buffer {
  return Buffer.from(unsignedXml, 'utf8');
}

/**
 * Sign an unsigned AuthTokenRequest envelope and return an enveloped-signature
 * document: the original envelope wrapped with a `<ds:Signature>` block carrying
 * the RSA-SHA256 `<ds:SignatureValue>` and the signer cert in
 * `<ds:X509Certificate>`.
 */
export function signXadesForTest(unsignedXml: string, material: TestSigningMaterial): string {
  const signer = createSign(RSA_SHA256_ALG);
  signer.update(canonicalizeForSigning(unsignedXml));
  signer.end();
  const signatureValue = signer.sign(material.privateKey).toString('base64');

  return [
    '<SignedAuthTokenRequest>',
    unsignedXml,
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    '<ds:SignedInfo>',
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>',
    '</ds:SignedInfo>',
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>`,
    '<ds:KeyInfo><ds:X509Data>',
    `<ds:X509Certificate>${material.certificateB64}</ds:X509Certificate>`,
    '</ds:X509Data></ds:KeyInfo>',
    '</ds:Signature>',
    '</SignedAuthTokenRequest>',
  ].join('');
}

/**
 * Verify a document produced by `signXadesForTest` against the signer cert's
 * public key: extracts the `<ds:SignatureValue>`, recomputes the digest over the
 * inner envelope, and checks the RSA-SHA256 signature. Returns true on a valid
 * signature.
 */
export function verifyXadesForTest(
  signedXml: string,
  unsignedXml: string,
  material: TestSigningMaterial,
): boolean {
  const match = /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/.exec(signedXml);
  if (!match) {
    return false;
  }
  const signatureValue = Buffer.from(match[1], 'base64');
  const verifier = createVerify(RSA_SHA256_ALG);
  verifier.update(canonicalizeForSigning(unsignedXml));
  verifier.end();
  return verifier.verify(material.publicKey, signatureValue);
}
