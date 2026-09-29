import ExcelJS from 'exceljs';
import { OrderRecord } from '@openlinker/core/orders';
import { buildOrderExportXlsx } from './order-export-xlsx';

function makeOrder(): OrderRecord {
  return new OrderRecord(
    'ol_order_xlsx_pii',
    null,
    '11111111-1111-4111-8111-111111111111',
    null,
    {
      orderNumber: 'PL-9002',
      billingAddress: { firstName: 'Norbert', lastName: 'Kulus' },
      customerEmail: 'norbert@example.com',
      items: [],
    },
    [],
    'ready',
    new Date('2026-05-01T10:00:00Z'),
    new Date('2026-05-01T10:00:00Z'),
  );
}

async function readSheetRows(buffer: Buffer): Promise<(string | number | boolean | null)[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Orders');
  const rows: (string | number | boolean | null)[][] = [];
  sheet?.eachRow((row) => {
    rows.push(row.values as (string | number | boolean | null)[]);
  });
  return rows;
}

describe('buildOrderExportXlsx', () => {
  it('writes the raw PII values when storePii is true (default)', async () => {
    const buffer = await buildOrderExportXlsx([makeOrder()], ['orderNumber', 'customerName', 'customerEmail']);
    const rows = await readSheetRows(buffer);
    const dataRow = rows[1];

    expect(dataRow).toContain('Norbert Kulus');
    expect(dataRow).toContain('norbert@example.com');
  });

  it('blanks every PII column unconditionally when storePii is false, even over a raw snapshot', async () => {
    const buffer = await buildOrderExportXlsx(
      [makeOrder()],
      ['orderNumber', 'customerName', 'customerEmail'],
      false,
    );
    const rows = await readSheetRows(buffer);
    const dataRow = rows[1];
    const flattened = dataRow.filter((v) => v !== undefined && v !== null).join(' ');

    expect(flattened).not.toContain('Norbert');
    expect(flattened).not.toContain('norbert@example.com');
    expect(flattened).toContain('PL-9002');
  });
});
