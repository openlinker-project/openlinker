import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { IProductsService } from '@openlinker/core/products';
import { PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { StoredTaxRate } from '@openlinker/core/products';

import { OrderLineItem } from '../../domain/entities/order-line-item.entity';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import {
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import { TaxRateBackfillService } from './tax-rate-backfill.service';

describe('TaxRateBackfillService', () => {
  let service: TaxRateBackfillService;
  let lineItemRepository: jest.Mocked<
    Pick<OrderLineItemRepositoryPort, 'findPageWithNoTaxRate' | 'backfillTaxRate'>
  >;
  let recordRepository: jest.Mocked<Pick<OrderRecordRepositoryPort, 'patchSnapshotTaxRates'>>;
  let productsService: jest.Mocked<Pick<IProductsService, 'getEffectiveTaxRate'>>;

  const makeLine = (overrides: Partial<OrderLineItem> = {}): OrderLineItem =>
    new OrderLineItem(
      overrides.id ?? 'line-1',
      overrides.orderRecordId ?? 'ol_order_1',
      overrides.lineNumber ?? 0,
      overrides.productId ?? 'ol_product_1',
      overrides.variantId ?? null,
      overrides.quantity ?? 1,
      overrides.unitPrice ?? 100,
      overrides.sourceConnectionId ?? 'conn-1',
      overrides.placedAt ?? new Date('2026-01-01T00:00:00Z'),
      overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
      overrides.taxRate ?? null,
      overrides.taxSource ?? null,
      overrides.taxRateReadAt ?? null
    );

  const known = (code: string): StoredTaxRate => ({
    code,
    countryIso2: 'PL',
    readAt: new Date('2026-08-24T00:00:00Z'),
  });
  const unknown: StoredTaxRate = { code: null, countryIso2: null, readAt: null };

  beforeEach(async () => {
    const mockLineItemRepository = {
      findPageWithNoTaxRate: jest.fn(),
      backfillTaxRate: jest.fn(),
    };
    const mockRecordRepository = {
      patchSnapshotTaxRates: jest.fn(),
    };
    const mockProductsService = {
      getEffectiveTaxRate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxRateBackfillService,
        { provide: ORDER_LINE_ITEM_REPOSITORY_TOKEN, useValue: mockLineItemRepository },
        { provide: ORDER_RECORD_REPOSITORY_TOKEN, useValue: mockRecordRepository },
        { provide: PRODUCTS_SERVICE_TOKEN, useValue: mockProductsService },
      ],
    }).compile();

    service = module.get(TaxRateBackfillService);
    lineItemRepository = module.get(ORDER_LINE_ITEM_REPOSITORY_TOKEN);
    recordRepository = module.get(ORDER_RECORD_REPOSITORY_TOKEN);
    productsService = module.get(PRODUCTS_SERVICE_TOKEN);
  });

  it('writes the resolved catalogue rate to both the line-item row and the snapshot', async () => {
    const line = makeLine({ id: 'line-1', orderRecordId: 'ol_order_1', lineNumber: 2 });
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([line]);
    productsService.getEffectiveTaxRate.mockResolvedValue(known('23'));

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 100,
      afterId: null,
    });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(lineItemRepository.backfillTaxRate).toHaveBeenCalledWith(
      'line-1',
      expect.objectContaining({ taxRate: '23', taxSource: 'backfill' })
    );
    expect(recordRepository.patchSnapshotTaxRates).toHaveBeenCalledWith(
      'ol_order_1',
      2,
      expect.objectContaining({ taxRate: '23', taxSource: 'backfill' })
    );
  });

  it('leaves a line untouched when the catalogue has no resolved rate', async () => {
    const line = makeLine();
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([line]);
    productsService.getEffectiveTaxRate.mockResolvedValue(unknown);

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 100,
      afterId: null,
    });

    expect(result.updated).toBe(0);
    expect(lineItemRepository.backfillTaxRate).not.toHaveBeenCalled();
    expect(recordRepository.patchSnapshotTaxRates).not.toHaveBeenCalled();
  });

  it('never throws when a catalogue read fails for one line, and skips only that line', async () => {
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([
      makeLine({ id: 'line-1' }),
      makeLine({ id: 'line-2' }),
    ]);
    productsService.getEffectiveTaxRate
      .mockRejectedValueOnce(new Error('catalogue unavailable'))
      .mockResolvedValueOnce(known('8'));

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 100,
      afterId: null,
    });

    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(1);
    expect(lineItemRepository.backfillTaxRate).toHaveBeenCalledTimes(1);
    expect(lineItemRepository.backfillTaxRate).toHaveBeenCalledWith(
      'line-2',
      expect.objectContaining({ taxRate: '8' })
    );
  });

  it("treats a '0' rate as a real, writable answer, never as absence", async () => {
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([makeLine({ id: 'line-1' })]);
    productsService.getEffectiveTaxRate.mockResolvedValue(known('0'));

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 100,
      afterId: null,
    });

    expect(result.updated).toBe(1);
    expect(lineItemRepository.backfillTaxRate).toHaveBeenCalledWith(
      'line-1',
      expect.objectContaining({ taxRate: '0' })
    );
  });

  it('returns nextCursor as the last line id when the page is full (more may remain)', async () => {
    const lines = [makeLine({ id: 'line-1' }), makeLine({ id: 'line-2' })];
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue(lines);
    productsService.getEffectiveTaxRate.mockResolvedValue(unknown);

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 2,
      afterId: null,
    });

    expect(result.nextCursor).toBe('line-2');
  });

  it('returns nextCursor null when the page is short (frontier exhausted)', async () => {
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([makeLine({ id: 'line-1' })]);
    productsService.getEffectiveTaxRate.mockResolvedValue(unknown);

    const result = await service.backfillPage({
      sourceConnectionId: 'conn-1',
      limit: 100,
      afterId: null,
    });

    expect(result.nextCursor).toBeNull();
  });

  it('passes the afterId cursor and connection scope through to the repository read', async () => {
    lineItemRepository.findPageWithNoTaxRate.mockResolvedValue([]);

    await service.backfillPage({ sourceConnectionId: 'conn-1', limit: 50, afterId: 'line-99' });

    expect(lineItemRepository.findPageWithNoTaxRate).toHaveBeenCalledWith({
      sourceConnectionId: 'conn-1',
      limit: 50,
      afterId: 'line-99',
    });
  });
});
