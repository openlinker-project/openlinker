/**
 * Amazon return mapper and flat-file tests (#4184)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import { parseAmazonFlatFile, writeAmazonFlatFile } from '../amazon-flat-file';
import { groupAmazonReturnRows, isTerminalAmazonReturnStatus, toIncomingReturn } from '../amazon-return.mapper';

const REPORT = [
  'Order ID\tOrder date\tReturn request date\tReturn request status\tAmazon RMA ID\tASIN\tMerchant SKU\tItem Name\tReturn quantity\tReturn reason\tOrder Amount\tOrder quantity',
  '302-1\t2026-11-01\t2026-11-10T08:00:00Z\tApproved\tRMA1\tB0A\tMUG-RED\tRed mug\t1\tDEFECTIVE\t39,98\t2',
  '302-1\t2026-11-01\t2026-11-10T08:00:00Z\tApproved\tRMA1\tB0B\tMUG-BLUE\tBlue mug\t2\tNO_LONGER_WANTED\t20.00\t2',
  '302-2\t2026-11-02\tnot a date\tClosed\tRMA2\tB0C\tCUP\tCup\t\t\t\t',
].join('\n');

describe('parseAmazonFlatFile', () => {
  it('should key rows by normalised header', () => {
    const [row] = parseAmazonFlatFile(`﻿Amazon RMA ID\tmerchant-sku\nRMA1\tMUG\n\n`);
    expect(row).toEqual({ amazonrmaid: 'RMA1', merchantsku: 'MUG' });
  });

  it('should write tab-separated rows without tabs or line breaks inside values', () => {
    expect(writeAmazonFlatFile(['a', 'b'], [['x\ty', 'z\n']])).toBe('a\tb\nx y\tz \n');
  });
});

describe('groupAmazonReturnRows', () => {
  const returns = groupAmazonReturnRows(parseAmazonFlatFile(REPORT), '2026-11-17T00:00:00.000Z');

  it('should group the rows of one RMA into one return with its lines', () => {
    expect(returns).toHaveLength(2);
    expect(returns[0]).toEqual({
      rmaId: 'RMA1',
      orderId: '302-1',
      status: 'Approved',
      requestedAt: '2026-11-10T08:00:00.000Z',
      lines: [
        { sku: 'MUG-RED', asin: 'B0A', name: 'Red mug', quantity: 1, reason: 'DEFECTIVE', unitPrice: 19.99 },
        { sku: 'MUG-BLUE', asin: 'B0B', name: 'Blue mug', quantity: 2, reason: 'NO_LONGER_WANTED', unitPrice: 10 },
      ],
    });
  });

  it('should fall back to the window end for an unreadable date and to one unit for a missing quantity', () => {
    expect(returns[1].requestedAt).toBe('2026-11-17T00:00:00.000Z');
    expect(returns[1].lines[0]).toEqual(expect.objectContaining({ quantity: 1, unitPrice: null, reason: null }));
  });

  it('should map to a neutral return, terminal only for closed or rejected', () => {
    const incoming = toIncomingReturn(returns[1]);
    expect(incoming).toEqual(
      expect.objectContaining({
        externalReturnId: 'RMA2',
        externalOrderId: '302-2',
        rawStatus: 'Closed',
        isTerminalAtSource: true,
        lines: [{ externalLineId: '1', offerId: 'B0C', sku: 'CUP', name: 'Cup', quantity: 1 }],
      }),
    );
    expect(isTerminalAmazonReturnStatus('rejected')).toBe(true);
    expect(isTerminalAmazonReturnStatus('Approved')).toBe(false);
  });
});
