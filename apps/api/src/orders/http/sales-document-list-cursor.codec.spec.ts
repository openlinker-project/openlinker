import { BadRequestException } from '@nestjs/common';
import {
  decodeSalesDocumentListCursor,
  encodeSalesDocumentListCursor,
} from './sales-document-list-cursor.codec';

describe('sales-document-list-cursor.codec', () => {
  it('round-trips a cursor with both sides populated', () => {
    const cursor = {
      invoice: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'a1' },
      fiscal: { createdAt: new Date('2026-01-02T00:00:00.000Z'), id: 'b2' },
    };
    const encoded = encodeSalesDocumentListCursor(cursor);
    const decoded = decodeSalesDocumentListCursor(encoded);

    expect(decoded).toEqual(cursor);
  });

  it('preserves an exhausted (null) side distinctly from an undefined one', () => {
    const cursor = {
      invoice: null,
      fiscal: undefined,
    };
    const decoded = decodeSalesDocumentListCursor(encodeSalesDocumentListCursor(cursor));

    expect(decoded?.invoice).toBeNull();
    expect(decoded?.fiscal).toBeUndefined();
  });

  it('returns undefined (first page) when no cursor string is supplied', () => {
    expect(decodeSalesDocumentListCursor(undefined)).toBeUndefined();
  });

  it('throws BadRequestException for a malformed cursor string', () => {
    expect(() => decodeSalesDocumentListCursor('not-valid-base64url-json')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a cursor whose side is missing required fields', () => {
    const malformed = Buffer.from(JSON.stringify({ invoice: { id: 'a1' } }), 'utf8').toString(
      'base64url',
    );

    expect(() => decodeSalesDocumentListCursor(malformed)).toThrow(BadRequestException);
  });
});
