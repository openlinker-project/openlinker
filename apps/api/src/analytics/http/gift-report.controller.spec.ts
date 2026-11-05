/**
 * Gift report controller and CSV unit tests (#3943)
 */
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { GiftReportController } from './gift-report.controller';
import { buildGiftCustomerCsv } from './gift-report-csv';
import { EXPORT_RANGE_TOO_WIDE_CODE } from './export-range';
import type { IGiftReportApiService } from '../application/services/gift-report-api.service.interface';
import type { IConnectionService } from '../../integrations/application/interfaces/connection.service.interface';
import type { GiftCustomerExportRow } from '../application/services/gift-report-api.service.interface';

async function read(stream: AsyncIterable<unknown>): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += String(chunk);
  return out;
}

describe('GiftReportController', () => {
  const reports = {
    getCustomerExportRows: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IGiftReportApiService>;
  const connections = { list: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<IConnectionService>;
  const controller = new GiftReportController(reports, connections);

  it('should answer the coded export error for a range wider than 400 days', async () => {
    const error = await controller
      .exportCsv({ from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: EXPORT_RANGE_TOO_WIDE_CODE,
    });
  });

  it('should allow the viewer role on the CSV export', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, GiftReportController.prototype.exportCsv) as string[];
    expect(roles).toContain('viewer');
  });
});

describe('buildGiftCustomerCsv source column', () => {
  const row = (giftSource: GiftCustomerExportRow['entry']['giftSource']): GiftCustomerExportRow =>
    ({
      entry: {
        giftSource,
        placedAt: null,
        customerId: null,
        orderNumber: 'A1',
        internalOrderId: 'o1',
        sourceConnectionId: 'c1',
        sku: 'S',
        name: 'Gift',
        quantity: 1,
        unitCostNet: null,
        totalCostNet: null,
        currency: 'PLN',
        documentForm: null,
        ruleRef: null,
      },
      customerName: null,
      ruleName: null,
    }) as unknown as GiftCustomerExportRow;

  it('should name each gift source explicitly', async () => {
    const csv = await read(
      buildGiftCustomerCsv({
        rows: [row('ol-rule'), row('channel'), row('cart-rule'), row('operator'), row('bundle')],
        labels: new Map(),
        from: new Date('2026-01-01'),
        to: new Date('2026-02-01'),
      })
    );

    for (const cell of ['promotion', 'channel', 'shop cart rule', 'added by hand', 'bundle slot']) {
      expect(csv).toContain(`,${cell},`);
    }
  });
});
