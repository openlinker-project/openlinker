import { computeStoredDocumentHash } from './stored-document-hash.types';

describe('computeStoredDocumentHash', () => {
  // Expected values come from `openssl dgst -sha256 -binary | base64url`, not
  // from this function.
  it('should return the Base64URL SHA-256 of the decoded bytes', () => {
    const hash = computeStoredDocumentHash({
      contentType: 'application/xml',
      contentBase64: Buffer.from('<Document>fake</Document>').toString('base64'),
    });

    expect(hash).toBe('gOfnt_ANkNNtJoW0Vx99Kf-ks2URL9JVXkIfbgJzo30');
  });

  it('should hash the bytes, not their Base64 text', () => {
    const bytes = Buffer.from([0xfb, 0xff, 0xfe]);

    const hash = computeStoredDocumentHash({
      contentType: 'application/octet-stream',
      contentBase64: bytes.toString('base64'),
    });

    expect(hash).not.toMatch(/[+/=]/);
    expect(hash).toHaveLength(43);
  });
});
