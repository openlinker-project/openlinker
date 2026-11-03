import {
  deriveDocumentToken,
  deriveRequestIdempotencyKey,
  deriveTransactionToken,
} from '../document-token.policy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('document-token.policy', () => {
  it('should produce a UUIDv4-shaped token when given a connection and key', () => {
    expect(deriveDocumentToken('conn-1', 'key-1')).toMatch(UUID_V4);
    expect(deriveTransactionToken('conn-1', 'key-1')).toMatch(UUID_V4);
  });

  it('should be stable across calls when inputs are unchanged', () => {
    // The whole locator design rests on this: a later reconcile must re-derive
    // the same token the create used.
    expect(deriveDocumentToken('conn-1', 'key-1')).toBe(deriveDocumentToken('conn-1', 'key-1'));
  });

  it('should produce distinct document and transaction tokens for one registration', () => {
    expect(deriveDocumentToken('conn-1', 'key-1')).not.toBe(
      deriveTransactionToken('conn-1', 'key-1'),
    );
  });

  it('should differ when the connection differs', () => {
    expect(deriveDocumentToken('conn-1', 'key-1')).not.toBe(
      deriveDocumentToken('conn-2', 'key-1'),
    );
  });

  it('should differ when the key differs', () => {
    expect(deriveDocumentToken('conn-1', 'key-1')).not.toBe(
      deriveDocumentToken('conn-1', 'key-2'),
    );
  });

  it('should not collide when the concatenation of the parts is ambiguous', () => {
    // ('a', 'b c') and ('a b', 'c') concatenate identically without a separator.
    expect(deriveDocumentToken('a', 'b c')).not.toBe(deriveDocumentToken('a b', 'c'));
  });

  describe('deriveRequestIdempotencyKey', () => {
    const token = deriveDocumentToken('conn-1', 'key-1');

    it('should be a vendor-safe UUID that is NOT the document token', () => {
      const key = deriveRequestIdempotencyKey(token, { documentToken: token, a: 1 });
      expect(key).toMatch(UUID_V4);
      expect(key).not.toBe(token);
    });

    it('should repeat for the same body, so a transport retry replays', () => {
      expect(deriveRequestIdempotencyKey(token, { documentToken: token, a: 1 })).toBe(
        deriveRequestIdempotencyKey(token, { documentToken: token, a: 1 }),
      );
    });

    it('should change when the body changes, so a corrected retry is a new request', () => {
      expect(deriveRequestIdempotencyKey(token, { documentToken: token, merchantTIN: '1' })).not.toBe(
        deriveRequestIdempotencyKey(token, { documentToken: token, merchantTIN: '2' }),
      );
    });

    it('should differ between two sales sending an identical body shape', () => {
      const other = deriveDocumentToken('conn-1', 'key-2');
      expect(deriveRequestIdempotencyKey(token, { a: 1 })).not.toBe(
        deriveRequestIdempotencyKey(other, { a: 1 }),
      );
    });
  });
});
