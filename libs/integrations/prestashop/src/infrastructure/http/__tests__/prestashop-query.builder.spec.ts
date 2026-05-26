/**
 * PrestaShop Query Builder Tests
 *
 * Unit tests for PrestashopQueryBuilder. Tests query string building,
 * date filtering, pagination, and PrestaShop-specific query syntax.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http/__tests__
 */
import { PrestashopQueryBuilder } from '../prestashop-query.builder';
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

    it('should add date=1 when updatedSince is provided', () => {
      const filters = {
        updatedSince: new Date('2024-01-01'),
      };
      const query = PrestashopQueryBuilder.buildQuery('orders', filters);
      expect(query).toContain('date=1');
      expect(query).toContain('filter[date_upd]');
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
      expect(query).toContain('filter[id]=[1,2,3]');
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
      expect(query).toContain('filter[current_state]=[pending,processing]');
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
