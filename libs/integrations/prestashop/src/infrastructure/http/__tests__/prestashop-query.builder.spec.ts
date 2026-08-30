/**
 * PrestaShop Query Builder Tests
 *
 * Unit tests for PrestashopQueryBuilder. Tests query string building,
 * date filtering, pagination, and PrestaShop-specific query syntax.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http/__tests__
 */
import type { PrestashopSort } from '../prestashop-query.builder';
import { PrestashopQueryBuilder } from '../prestashop-query.builder';
import { PrestashopInvalidFilterException } from '../../../domain/exceptions/prestashop-invalid-filter.exception';
import type { PrestashopConnectionConfig } from '@openlinker/integrations-prestashop';

describe('PrestashopQueryBuilder', () => {
  describe('buildQuery', () => {
    it('should build basic query with display=full', () => {
      const query = PrestashopQueryBuilder.buildQuery('products');
      expect(query).toContain('display=full');
    });

    it('should include shopId when provided in config', () => {
      const config: PrestashopConnectionConfig = {
        baseUrl: 'https://shop.example.com',
        shopId: 2,
      };
      const query = PrestashopQueryBuilder.buildQuery('products', undefined, config);
      expect(query).toContain('id_shop=2');
    });

    it('should add date=1 when date filters are provided', () => {
      const filters = {
        dateFrom: new Date('2024-01-01'),
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      expect(query).toContain('date=1');
      expect(query).toContain('filter[date_add]');
    });

    it('should add date=1 when updatedAfter is provided', () => {
      const filters = {
        updatedAfter: '2024-01-01 00:00:00',
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      expect(query).toContain('date=1');
      expect(query).toContain('filter[date_upd]');
    });

    it('should emit updatedAfter verbatim so the worker clock is never an input (#2605)', () => {
      const original = process.env.TZ;
      const buildIn = (tz: string): string => {
        process.env.TZ = tz;
        return PrestashopQueryBuilder.buildQuery('orders', {
          updatedAfter: '2024-01-15 10:30:00',
        });
      };
      try {
        expect(buildIn('UTC')).toContain('filter[date_upd]=>[2024-01-15 10:30:00]');
        expect(buildIn('Pacific/Kiritimati')).toContain('filter[date_upd]=>[2024-01-15 10:30:00]');
      } finally {
        process.env.TZ = original;
      }
    });

    it('should emit a sort clause in the order given', () => {
      const query = PrestashopQueryBuilder.buildQuery('orders', {
        sort: ['date_upd_ASC', 'id_ASC'],
      });
      expect(query).toContain('sort=[date_upd_ASC,id_ASC]');
    });

    it('should reject a sort entry that is not a bare column plus direction', () => {
      expect(() =>
        PrestashopQueryBuilder.buildQuery('orders', { sort: ['date_upd'] as unknown as PrestashopSort[] })
      ).toThrow(PrestashopInvalidFilterException);
      expect(() =>
        PrestashopQueryBuilder.buildQuery('orders', { sort: ['date_upd_ASC,id_DESC'] as unknown as PrestashopSort[] })
      ).toThrow(PrestashopInvalidFilterException);
    });

    it('should format dates correctly for PrestaShop', () => {
      const filters = {
        dateFrom: new Date('2024-01-15T10:30:00Z'),
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      // PrestaShop expects: YYYY-MM-DD HH:MM:SS
      expect(query).toMatch(/filter\[date_add\]=>\[2024-01-15 \d{2}:\d{2}:\d{2}\]/);
    });

    it('should handle ID filters', () => {
      const filters = {
        ids: [1, 2, 3],
      };
      const query = PrestashopQueryBuilder.buildQuery('products', filters);
      // Pipe, not comma: PrestaShop reads `[1,3]` as the RANGE 1 to 3 and
      // `[1|3]` as the OR list of exactly those ids (#2593).
      expect(query).toContain('filter[id]=[1|2|3]');
    });

    it('should emit an ordering when one is asked for', () => {
      const query = PrestashopQueryBuilder.buildQuery('products', {
        sort: ['date_upd_DESC'],
      });
      expect(query).toContain('sort=[date_upd_DESC]');
    });

    it('should emit no ordering by default', () => {
      const query = PrestashopQueryBuilder.buildQuery('products', {});
      expect(query).not.toContain('sort=');
    });

    it('should handle status filters', () => {
      const filters = {
        status: 'pending',
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      expect(query).toContain('filter[current_state]=[pending]');
    });

    it('should handle multiple status filters', () => {
      const filters = {
        status: ['pending', 'processing'],
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      expect(query).toContain('filter[current_state]=[pending|processing]');
    });

    it('should pipe-join a custom filter list so PrestaShop reads it as an OR list', () => {
      const query = PrestashopQueryBuilder.buildQuery('combinations', {
        custom: { id_product: ['3', '9', '41'] },
      });

      // A comma is a RANGE in PrestaShop, so `[3,41]` would return every product
      // between 3 and 41 and nothing for the ids outside that span (#2593).
      expect(query).toContain('filter[id_product]=[3|9|41]');
      expect(query).not.toContain('filter[id_product]=[3,9,41]');
    });

    it('should handle custom filters', () => {
      const filters = {
        custom: {
          active: 1,
          category_id: 5,
        },
      };
      const query = PrestashopQueryBuilder.buildQuery('products', filters);
      expect(query).toContain('filter[active]=[1]');
      expect(query).toContain('filter[category_id]=[5]');
    });

    it('should build a single filter envelope when the custom key is a bare field name', () => {
      const query = PrestashopQueryBuilder.buildQuery('products', {
        custom: { reference: 'ol_variant_aaaa' },
      });

      expect(query).toContain('filter[reference]=[ol_variant_aaaa]');
      expect(query).not.toContain('filter[filter[');
    });

    it('should throw when a custom filter key is already wrapped in filter[...]', () => {
      expect(() =>
        PrestashopQueryBuilder.buildQuery('products', {
          custom: { 'filter[reference]': 'ol_variant_aaaa' },
        })
      ).toThrow(PrestashopInvalidFilterException);
    });

    it('should name the offending key and the envelope hint when the filter is wrapped', () => {
      try {
        PrestashopQueryBuilder.buildQuery('products', {
          custom: { 'filter[reference]': 'ol_variant_aaaa' },
        });
        fail('expected a PrestashopInvalidFilterException');
      } catch (error) {
        const invalid = error as PrestashopInvalidFilterException;
        expect(invalid.filterKey).toBe('filter[reference]');
        expect(invalid.message).toContain('filter[...] envelope');
      }
    });

    it('should throw when a custom filter key is not a bare field name', () => {
      expect(() =>
        PrestashopQueryBuilder.buildQuery('products', {
          custom: { 'reference&display': 'x' },
        })
      ).toThrow(PrestashopInvalidFilterException);
    });
  });

  describe('buildQueryWithPagination', () => {
    it('should emit count-only limit when no offset is given', () => {
      const query = PrestashopQueryBuilder.buildQueryWithPagination(
        'products',
        undefined,
        undefined,
        50
      );
      expect(query).toContain('limit=50');
      // PrestaShop has no standalone `offset` parameter — it must never appear.
      expect(query).not.toContain('offset=');
    });

    it('should emit `limit=offset,count` when paginating with an offset (#851)', () => {
      // PrestaShop pagination syntax is `limit=[offset,]count` (offset 0-indexed),
      // NOT a separate `offset=` param. limit=200, offset=200 → page 2 of 200.
      const query = PrestashopQueryBuilder.buildQueryWithPagination(
        'products',
        undefined,
        undefined,
        200,
        200
      );
      expect(query).toContain('limit=200,200');
      expect(query).not.toContain('offset=');
      expect(query).not.toContain('limit=200&'); // not the bare count form
    });

    it('should drop a bare offset that has no count (cannot be expressed in PrestaShop)', () => {
      const query = PrestashopQueryBuilder.buildQueryWithPagination(
        'products',
        undefined,
        undefined,
        undefined,
        100
      );
      expect(query).not.toContain('offset=');
      expect(query).not.toContain('limit=');
    });

    it('should combine filters and offset pagination', () => {
      const filters = {
        status: 'pending',
      };
      const query = PrestashopQueryBuilder.buildQueryWithPagination(
        'orders',
        filters,
        undefined,
        25,
        50
      );
      expect(query).toContain('filter[current_state]=[pending]');
      // offset=50, count=25 → `limit=50,25`.
      expect(query).toContain('limit=50,25');
      expect(query).not.toContain('offset=');
    });
  });

  describe('buildResourcePath', () => {
    it('should build path for resource list', () => {
      const path = PrestashopQueryBuilder.buildResourcePath('products');
      expect(path).toBe('/api/products');
    });

    it('should build path for single resource', () => {
      const path = PrestashopQueryBuilder.buildResourcePath('products', 123);
      expect(path).toBe('/api/products/123');
    });

    it('should handle string IDs', () => {
      const path = PrestashopQueryBuilder.buildResourcePath('orders', '456');
      expect(path).toBe('/api/orders/456');
    });
  });
});
