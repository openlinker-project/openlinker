import { OrderRecord } from './entities/order-record.entity';
import { buildOrderExportCsv } from './order-export-csv';

function makeOrder(orderNumber: string): OrderRecord {
  return new OrderRecord(
    `ol_order_${orderNumber}`,
    null,
    '11111111-1111-4111-8111-111111111111',
    null,
    { orderNumber, items: [] },
    [],
    'ready',
    new Date('2026-05-01T10:00:00Z'),
    new Date('2026-05-01T10:00:00Z'),
  );
}

describe('buildOrderExportCsv', () => {
  it('starts with a UTF-8 BOM and a header row matching the requested columns', () => {
    const csv = buildOrderExportCsv([], ['orderNumber', 'internalOrderId']);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Order #;Order ID');
  });

  it('escapes a value containing the separator or a quote', () => {
    const order = makeOrder('PL;"weird"');
    const csv = buildOrderExportCsv([order], ['orderNumber']);
    expect(csv).toContain('"PL;""weird"""');
  });

  it('prefixes a formula-looking string cell to defeat CSV/formula injection', () => {
    const order = makeOrder('=SUM(A1:A2)');
    const csv = buildOrderExportCsv([order], ['orderNumber']);
    expect(csv).toContain("'=SUM(A1:A2)");
  });

  it('writes a PII column as an empty cell when storePii is false, even over a raw snapshot', () => {
    const order = new OrderRecord(
      'ol_order_pii',
      null,
      '11111111-1111-4111-8111-111111111111',
      null,
      {
        orderNumber: 'PL-9001',
        billingAddress: { firstName: 'Norbert', lastName: 'Kulus' },
        customerEmail: 'norbert@example.com',
        items: [],
      },
      [],
      'ready',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T10:00:00Z'),
    );

    const csvWithPii = buildOrderExportCsv([order], ['customerName', 'customerEmail'], true);
    expect(csvWithPii).toContain('Norbert Kulus');
    expect(csvWithPii).toContain('norbert@example.com');

    const csvWithoutPii = buildOrderExportCsv([order], ['orderNumber', 'customerName', 'customerEmail'], false);
    expect(csvWithoutPii).not.toContain('Norbert');
    expect(csvWithoutPii).not.toContain('norbert@example.com');
    // The row is still written — only the two PII cells are blank.
    expect(csvWithoutPii.split('\r\n')[1]).toBe('PL-9001;;');
  });

  it('never prefixes a numeric cell even when negative', () => {
    const order = new OrderRecord(
      'ol_order_neg',
      null,
      '11111111-1111-4111-8111-111111111111',
      null,
      { orderNumber: 'N1', totals: { total: -5 }, currency: 'PLN' },
      [],
      'ready',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T10:00:00Z'),
    );
    const csv = buildOrderExportCsv([order], ['totalAmount']);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('-5');
  });
});
