/**
 * Bench receipt link boundary (#3647 review)
 *
 * The link is a fiscal provider's own string and becomes an `href`, so the
 * parser is where a scheme that would run code on the OpenLinker origin is
 * refused.
 */
import { describe, expect, it } from 'vitest';

import { parseBenchReceiptLink } from './bench-parcel.schema';

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
