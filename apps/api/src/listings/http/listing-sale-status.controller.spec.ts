/**
 * Listing Sale Status Controller - unit tests (#3962)
 *
 * Pins the wire shape of the product page's "Sales channels" read (dates as
 * ISO strings, orders since deletion counted from the deleted variants' SKUs,
 * null when nothing is deleted), the 409 mapping of a refused release, and the
 * products-list attention count.
 *
 * @module apps/api/src/listings/http
 */
import { ConflictException } from '@nestjs/common';
import {
  SaleHoldReleaseRefusedException,
  type IListingSaleStatusService,
  type ProductSaleStatus,
} from '@openlinker/core/listings';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';

import type { AuthenticatedUser } from '../../auth/auth.types';
import { ListingSaleStatusController } from './listing-sale-status.controller';

const DELETED_AT = new Date('2026-07-03T10:00:00.000Z');
const CHECKED_AT = new Date('2026-07-04T08:00:00.000Z');
const APPLIED_AT = new Date('2026-07-03T10:05:00.000Z');

function variant(id: string, sku: string | null): ProductVariant {
  return {
    id,
    productId: 'ol_product_a',
    sku,
    attributes: null,
    ean: null,
    gtin: null,
    isStale: true,
    staleAt: DELETED_AT,
  };
}

function status(overrides: Partial<ProductSaleStatus> = {}): ProductSaleStatus {
  return {
    productId: 'ol_product_a',
    deletedAt: null,
    deletedAtSource: false,
    staleVariantIds: [],
    rows: [],
    checkedAt: null,
    ...overrides,
  };
}

const USER: AuthenticatedUser = { id: 'user-1', username: 'op', role: 'operator' };

describe('ListingSaleStatusController', () => {
  let saleStatus: jest.Mocked<IListingSaleStatusService>;
  let products: { getVariantsByProductId: jest.Mock };
  let orderRecords: { countOrdersForSkusSince: jest.Mock };
  let controller: ListingSaleStatusController;

  beforeEach(() => {
    saleStatus = {
      getProductSaleStatus: jest.fn(),
      releaseHolds: jest.fn(),
      findActiveHolds: jest.fn(),
      countProductsStillOnSale: jest.fn(),
    };
    products = { getVariantsByProductId: jest.fn().mockResolvedValue([]) };
    orderRecords = { countOrdersForSkusSince: jest.fn().mockResolvedValue(0) };
    controller = new ListingSaleStatusController(
      saleStatus,
      products as unknown as IProductsService,
      orderRecords as unknown as IOrderRecordService
    );
  });

  describe('getSaleStatus', () => {
    it('should map dates to ISO strings and count orders since deletion from the deleted SKUs when a variant is deleted', async () => {
      saleStatus.getProductSaleStatus.mockResolvedValue(
        status({
          deletedAt: DELETED_AT,
          deletedAtSource: true,
          staleVariantIds: ['ol_variant_a', 'ol_variant_b'],
          checkedAt: CHECKED_AT,
          rows: [
            {
              connectionId: 'shop-1',
              entityType: 'ShopProduct',
              externalId: 'V1',
              externalParentId: 'P100',
              internalVariantId: 'ol_variant_a',
              channelStatus: 'published',
              quantity: null,
              lastCheckedAt: CHECKED_AT,
              hold: {
                id: 'hold-1',
                method: 'stock_zero',
                outcome: 'applied',
                outcomeReason: null,
                appliedAt: APPLIED_AT,
              },
              state: 'off_sale',
            },
            {
              connectionId: 'allegro-1',
              entityType: 'Offer',
              externalId: 'offer-1',
              externalParentId: null,
              internalVariantId: 'ol_variant_c',
              channelStatus: null,
              quantity: 3,
              lastCheckedAt: null,
              hold: null,
              state: 'on_sale',
            },
          ],
        })
      );
      products.getVariantsByProductId.mockResolvedValue([
        variant('ol_variant_a', 'SKU-A'),
        variant('ol_variant_b', null),
        variant('ol_variant_c', 'SKU-C'),
      ]);
      orderRecords.countOrdersForSkusSince.mockResolvedValue(4);

      const response = await controller.getSaleStatus('ol_product_a');

      expect(products.getVariantsByProductId).toHaveBeenCalledWith('ol_product_a');
      expect(orderRecords.countOrdersForSkusSince).toHaveBeenCalledWith(['SKU-A'], DELETED_AT);
      expect(response).toEqual({
        productId: 'ol_product_a',
        deletedAtSource: true,
        deletedAt: '2026-07-03T10:00:00.000Z',
        staleVariantIds: ['ol_variant_a', 'ol_variant_b'],
        staleSkus: ['SKU-A'],
        ordersSinceDeletion: 4,
        checkedAt: '2026-07-04T08:00:00.000Z',
        rows: [
          {
            connectionId: 'shop-1',
            entityType: 'ShopProduct',
            externalId: 'V1',
            externalParentId: 'P100',
            internalVariantId: 'ol_variant_a',
            channelStatus: 'published',
            quantity: null,
            lastCheckedAt: '2026-07-04T08:00:00.000Z',
            hold: {
              id: 'hold-1',
              method: 'stock_zero',
              outcome: 'applied',
              outcomeReason: null,
              appliedAt: '2026-07-03T10:05:00.000Z',
            },
            state: 'off_sale',
          },
          {
            connectionId: 'allegro-1',
            entityType: 'Offer',
            externalId: 'offer-1',
            externalParentId: null,
            internalVariantId: 'ol_variant_c',
            channelStatus: null,
            quantity: 3,
            lastCheckedAt: null,
            hold: null,
            state: 'on_sale',
          },
        ],
      });
    });

    it('should report null orders and skip the variant and order reads when nothing is deleted', async () => {
      saleStatus.getProductSaleStatus.mockResolvedValue(status());

      const response = await controller.getSaleStatus('ol_product_a');

      expect(products.getVariantsByProductId).not.toHaveBeenCalled();
      expect(orderRecords.countOrdersForSkusSince).not.toHaveBeenCalled();
      expect(response.ordersSinceDeletion).toBeNull();
      expect(response.deletedAt).toBeNull();
      expect(response.checkedAt).toBeNull();
      expect(response.staleSkus).toEqual([]);
    });

    it('should report the count as unknown when the deleted variants carry no SKU', async () => {
      saleStatus.getProductSaleStatus.mockResolvedValue(
        status({ deletedAt: DELETED_AT, deletedAtSource: true, staleVariantIds: ['ol_variant_b'] })
      );
      products.getVariantsByProductId.mockResolvedValue([variant('ol_variant_b', null)]);

      const response = await controller.getSaleStatus('ol_product_a');

      expect(orderRecords.countOrdersForSkusSince).not.toHaveBeenCalled();
      expect(response.ordersSinceDeletion).toBeNull();
    });
  });

  describe('release', () => {
    it('should release the requested holds as the current user when the service accepts', async () => {
      saleStatus.releaseHolds.mockResolvedValue({ released: ['hold-1'], failed: [] });

      const response = await controller.release('ol_product_a', { holdIds: ['hold-1'] }, USER);

      expect(saleStatus.releaseHolds).toHaveBeenCalledWith('ol_product_a', ['hold-1'], 'user-1');
      expect(response).toEqual({ released: ['hold-1'], failed: [] });
    });

    it('should map a refused release to a 409 ConflictException when the product is still deleted', async () => {
      saleStatus.releaseHolds.mockRejectedValue(
        new SaleHoldReleaseRefusedException('ol_product_a', ['hold-1'])
      );

      await expect(
        controller.release('ol_product_a', { holdIds: ['hold-1'] }, USER)
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        controller.release('ol_product_a', { holdIds: ['hold-1'] }, USER)
      ).rejects.toMatchObject({ response: { code: 'SALE_HOLD_RELEASE_REFUSED' } });
    });

    it('should rethrow any other error unchanged when the release fails', async () => {
      const boom = new Error('db down');
      saleStatus.releaseHolds.mockRejectedValue(boom);

      await expect(controller.release('ol_product_a', { holdIds: ['hold-1'] }, USER)).rejects.toBe(
        boom
      );
    });
  });

  describe('attentionCount', () => {
    it('should return the number of products still on sale when asked', async () => {
      saleStatus.countProductsStillOnSale.mockResolvedValue(2);

      await expect(controller.attentionCount()).resolves.toEqual({ productsStillOnSale: 2 });
    });
  });
});
