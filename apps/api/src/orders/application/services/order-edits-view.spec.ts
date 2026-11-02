/**
 * Discount proposal projection unit tests (#3543).
 *
 * A reloaded page reads the open proposals back from the persisted change rows,
 * so the repriced lines, the invoice id and the document number must survive the
 * round trip through `payload`.
 */
import type { OrderChange } from '@openlinker/core/orders';

import { buildDiscountProposals, readDiscountCorrectionLines } from './order-edits-view';

const change = (overrides: Record<string, unknown>): OrderChange =>
  ({
    id: 'change-1',
    kind: 'order.discount_correction',
    status: 'requested',
    requestedAt: new Date('2026-09-25T11:02:00.000Z'),
    isOpen: () => true,
    payload: {},
    ...overrides,
  }) as unknown as OrderChange;

describe('buildDiscountProposals', () => {
  it('should expose the lines, document number and invoice id of a correction', () => {
    const lines = [
      { originalLineNumber: 1, name: 'Mug', previousUnitPriceGross: 39, newUnitPriceGross: 36 },
    ];
    const [entry] = buildDiscountProposals([
      change({ payload: { invoiceRecordId: 'inv_1', documentNumber: 'FV/1', currency: 'PLN', lines } }),
    ]);

    expect(entry).toMatchObject({
      kind: 'order.discount_correction',
      invoiceRecordId: 'inv_1',
      documentNumber: 'FV/1',
      lines,
      amount: null,
    });
  });

  it('should leave a refund intent without document fields', () => {
    const [entry] = buildDiscountProposals([
      change({ kind: 'order.discount_refund', payload: { amount: '15.00', currency: 'PLN' } }),
    ]);

    expect(entry).toMatchObject({
      amount: '15.00',
      invoiceRecordId: null,
      documentNumber: null,
      lines: null,
    });
  });

  it('should skip closed proposals and other kinds', () => {
    expect(
      buildDiscountProposals([
        change({ isOpen: () => false }),
        change({ kind: 'order.address_change' }),
      ]),
    ).toEqual([]);
  });
});

describe('readDiscountCorrectionLines', () => {
  it('should drop malformed entries and report no lines for a non-array', () => {
    expect(readDiscountCorrectionLines(undefined)).toBeNull();
    expect(
      readDiscountCorrectionLines([
        { originalLineNumber: 1, name: 'Mug', previousUnitPriceGross: 39, newUnitPriceGross: 36 },
        { originalLineNumber: 'x' },
      ]),
    ).toHaveLength(1);
  });
});
