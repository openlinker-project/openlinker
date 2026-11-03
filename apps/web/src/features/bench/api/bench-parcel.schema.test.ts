/**
 * Bench wire parsing: change-size results (#3655, backend #3654) and the
 * receipt link boundary (#3647 review)
 *
 * The void state is the load-bearing member of a replace result: only an
 * explicit `confirmed` may read as confirmed, because a void claimed on a
 * missing value is the direction a packer acts wrongly on. The receipt link is
 * a fiscal provider's own string and becomes an `href`, so the parser is where
 * a scheme that would run code on the OpenLinker origin is refused.
 */
import { describe, expect, it } from 'vitest';

import type { BenchDocuments } from './bench-parcel.types';
import {
  parseBenchDocuments,
  parseBenchLabelReplaceResult,
  parseBenchReceiptLink,
  readReplaceRefusalReason,
} from './bench-parcel.schema';

describe('parseBenchLabelReplaceResult', () => {
  it('should read a replaced body with its kept size and a confirmed void', () => {
    expect(
      parseBenchLabelReplaceResult({
        outcome: 'replaced',
        cancelledShipmentId: 'a',
        newShipmentId: 'b',
        cancelledAfterDispatch: false,
        voidState: 'confirmed',
        keptTemplate: 'small',
      })
    ).toEqual({ outcome: 'replaced', reason: null, voidState: 'confirmed', keptTemplate: 'small' });
  });

  it.each(['confirmed', 'in-doubt'] as const)(
    'should carry voidState %s on cancelled-not-replaced',
    (voidState) => {
      expect(
        parseBenchLabelReplaceResult({
          outcome: 'cancelled-not-replaced',
          voidState,
          keptTemplate: null,
        })
      ).toMatchObject({ outcome: 'cancelled-not-replaced', voidState });
    }
  );

  it.each([undefined, null, 'something-newer'])(
    'should hold the void as in-doubt when voidState is %p',
    (voidState) => {
      expect(
        parseBenchLabelReplaceResult({ outcome: 'cancelled-not-replaced', voidState })
      ).toMatchObject({ voidState: 'in-doubt', keptTemplate: null });
    }
  );
});

describe('readReplaceRefusalReason', () => {
  it('should read the reason member of a 409 body', () => {
    expect(
      readReplaceRefusalReason({ reason: 'adapter-unresolved', message: 'adapter-unresolved' })
    ).toBe('adapter-unresolved');
  });

  it('should pass an unrecognised reason through so the dialog can fail closed on it', () => {
    expect(readReplaceRefusalReason({ reason: 'from-a-newer-api' })).toBe('from-a-newer-api');
  });

  it.each([null, 'Conflict', { message: 'cannot-cancel' }, { reason: 42 }])(
    'should answer null when the body carries no string reason: %p',
    (details) => {
      expect(readReplaceRefusalReason(details)).toBeNull();
    }
  );
});

describe('parseBenchReceiptLink', () => {
  it.each(['https://receipts.example.test/r/16240', 'http://receipts.example.test/r/16240?x=1'])(
    'should accept %s when it is an absolute http(s) URL',
    (url) => {
      expect(parseBenchReceiptLink({ url })).toEqual({ url });
    }
  );

  it.each([
    'javascript:alert(document.domain)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://receipts.example.test/r/16240',
    '/r/16240',
    '//receipts.example.test/r/16240',
    'receipts.example.test/r/16240',
    '',
  ])('should reject %j when it is not an absolute http(s) URL', (url) => {
    expect(() => parseBenchReceiptLink({ url })).toThrow();
  });

  it('should reject a payload with no url when the field is missing', () => {
    expect(() => parseBenchReceiptLink({})).toThrow();
  });
});

describe('parseBenchDocuments - the invoice verification link (#3649 review)', () => {
  const base = { workId: 'w-1', label: { state: 'none' } };
  const invoiceDocument = (verificationUrl: unknown): Record<string, unknown> => ({
    kind: 'invoice',
    recordId: 'inv-1',
    connectionId: 'conn-1',
    status: 'issued',
    documentNumber: 'FV/1',
    printable: false,
    verificationUrl,
  });

  it.each(['https://qr.ksef.mf.gov.pl/invoice/1/01-02-2026/h', 'http://qr.example.test/x?y=1'])(
    'should keep %s when it is an absolute http(s) URL',
    (url) => {
      const parsed = parseBenchDocuments({ ...base, document: invoiceDocument(url) });

      expect(parsed.document?.verificationUrl).toBe(url);
    }
  );

  it.each([
    'javascript:alert(document.domain)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://x.example.test/a',
    '/invoice/1',
    '',
  ])('should read %j as no link, without failing the rest of the read', (url) => {
    const parsed = parseBenchDocuments({ ...base, document: invoiceDocument(url) });

    expect(parsed.document?.verificationUrl).toBeNull();
    expect(parsed.label.state).toBe('none');
  });

  it('should read an absent link as no link', () => {
    const withoutUrl = invoiceDocument(null);
    delete withoutUrl.verificationUrl;

    const parsed = parseBenchDocuments({ ...base, document: withoutUrl });

    expect(parsed.document?.verificationUrl).toBeNull();
  });

  it('should apply the same constraint to the legacy invoice slot', () => {
    const legacy = (verificationUrl: string): BenchDocuments =>
      parseBenchDocuments({
        ...base,
        invoice: { state: 'link', invoiceId: 'inv-1', documentNumber: 'FV/1', verificationUrl },
      });

    expect(legacy('javascript:alert(1)').invoice?.verificationUrl).toBeNull();
    expect(legacy('https://qr.example.test/x').invoice?.verificationUrl).toBe(
      'https://qr.example.test/x'
    );
  });
});
