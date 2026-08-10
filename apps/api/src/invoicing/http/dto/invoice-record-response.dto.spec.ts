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
    'subiekt',
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
});
