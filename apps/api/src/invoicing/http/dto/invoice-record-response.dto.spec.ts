/**
 * InvoiceRecordResponseDto unit tests (#1995 — orderSummary projection).
 */
import { InvoiceRecord } from '@openlinker/core/invoicing';
import { InvoiceRecordResponseDto } from './invoice-record-response.dto';
import type { OrderSummary } from '@openlinker/core/orders';

function makeInvoiceRecord(): InvoiceRecord {
  return new InvoiceRecord(
    'inv_1',
    'connection_1',
    'ol_order_1',
    'subiekt-gt',
    'invoice',
    'issued',
    'provider-inv-1',
    'FV/1/2026',
    'not-applicable',
    null,
    null,
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    new Date('2026-05-20T10:00:00.000Z'),
  );
}

/**
 * A record carrying an explicit `buyerTaxId` (#3188). The field is the LAST
 * constructor parameter - appended there so every pre-existing positional call
 * site, including `makeInvoiceRecord` above, keeps compiling untouched - so
 * reaching it means spelling the defaults in between. That verbosity is the
 * cost of a positional constructor and is preferable to reordering it.
 */
function recordWithBuyerTaxId(buyerTaxId: string | null): InvoiceRecord {
  return new InvoiceRecord(
    'inv_1',
    'connection_1',
    'ol_order_1',
    'subiekt-gt',
    'invoice',
    'issued',
    'provider-inv-1',
    'FV/1/2026',
    'not-applicable',
    null,
    null,
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    new Date('2026-05-20T10:00:00.000Z'),
    null, // failureMode
    null, // failureCode
    null, // failureReason
    null, // leaseExpiresAt
    buyerTaxId !== null && buyerTaxId.length > 0, // hasBuyerTaxId
    null, // documentContent
    null, // sourceDocument
    null, // issuedLineSnapshot
    'unknown', // paymentStatus
    null, // numberingSeriesId
    null, // documentNumber
    null, // allocatedSeq
    buyerTaxId,
  );
}

describe('InvoiceRecordResponseDto.fromDomain', () => {
  it('sets orderSummary to null when no summary is supplied', () => {
    const dto = InvoiceRecordResponseDto.fromDomain(makeInvoiceRecord(), null);
    expect(dto.orderSummary).toBeNull();
  });

  it('maps a supplied OrderSummary onto the DTO', () => {
    const summary: OrderSummary = {
      orderNumber: 'ORD-001',
      firstItemName: 'Terra Wool Coat',
      firstItemImageUrl: 'https://example.com/coat.png',
      itemCount: 2,
    };

    const dto = InvoiceRecordResponseDto.fromDomain(makeInvoiceRecord(), summary);

    expect(dto.orderSummary).toEqual(summary);
  });

  // #3188 - the three-state buyer tax identity frozen at issue. The wire
  // contract is the order detail's: key ABSENT = not asserted, `null` =
  // asserted-none, string = the id the document carries. Collapsing the two
  // absences would erase the distinction that decides which fiscal document an
  // order gets in the first place.
  describe('buyerTaxId (#3188)', () => {
    it('carries the id verbatim when the record holds one', () => {
      const dto = InvoiceRecordResponseDto.fromDomain(
        recordWithBuyerTaxId('5213796333'),
        null,
      );
      expect(dto.buyerTaxId).toBe('5213796333');
    });

    it('reports null for the asserted-none row rather than an empty string', () => {
      const dto = InvoiceRecordResponseDto.fromDomain(recordWithBuyerTaxId(''), null);
      expect(dto.buyerTaxId).toBeNull();
    });

    it('omits the key entirely for a record that asserted nothing', () => {
      const dto = InvoiceRecordResponseDto.fromDomain(recordWithBuyerTaxId(null), null);
      expect(dto.buyerTaxId).toBeUndefined();
      // The key must not survive serialization as an explicit null, which a
      // consumer would read as "asserted none".
      expect(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(dto)), 'buyerTaxId')).toBe(
        false,
      );
    });
  });
});
