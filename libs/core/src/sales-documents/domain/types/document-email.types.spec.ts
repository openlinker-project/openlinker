import {
  DocumentEmailFailureReasonValues,
  isDocumentEmailFailureReason,
  normaliseDocumentEmailRecipient,
} from './document-email.types';

describe('normaliseDocumentEmailRecipient', () => {
  it('should return the trimmed address for a plain email', () => {
    expect(normaliseDocumentEmailRecipient('  buyer@example.com ')).toBe('buyer@example.com');
  });

  it('should accept a masked marketplace address with a plus tag', () => {
    expect(normaliseDocumentEmailRecipient('8awgqyk6a5+cub31c122@allegromail.pl')).toBe(
      '8awgqyk6a5+cub31c122@allegromail.pl'
    );
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['no at sign', 'buyer.example.com'],
    ['no domain dot', 'buyer@example'],
    ['two addresses', 'a@example.com, b@example.com'],
    ['semicolon list', 'a@example.com;b@example.com'],
    ['display name', 'Buyer <buyer@example.com>'],
    ['header injection', 'a@example.com\r\nBcc: x@example.com'],
    ['inner whitespace', 'a b@example.com'],
  ])('should refuse %s', (_label, value) => {
    expect(normaliseDocumentEmailRecipient(value)).toBeNull();
  });

  it('should refuse an address longer than 254 characters', () => {
    expect(normaliseDocumentEmailRecipient(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });

  it('should refuse a non-string', () => {
    expect(normaliseDocumentEmailRecipient(undefined)).toBeNull();
    expect(normaliseDocumentEmailRecipient(null)).toBeNull();
  });
});

describe('isDocumentEmailFailureReason', () => {
  it.each(DocumentEmailFailureReasonValues)('should recognise %s', (reason) => {
    expect(isDocumentEmailFailureReason(reason)).toBe(true);
  });

  it('should not recognise an unknown value', () => {
    expect(isDocumentEmailFailureReason('something-new')).toBe(false);
    expect(isDocumentEmailFailureReason(null)).toBe(false);
  });
});
