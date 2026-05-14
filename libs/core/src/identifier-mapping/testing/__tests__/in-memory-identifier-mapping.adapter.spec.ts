/**
 * InMemoryIdentifierMappingAdapter Tests
 *
 * Unit specs for the in-memory fake. Covers the ID-format contract, idempotency,
 * conflict semantics, and the `seed` / `clear` helpers.
 *
 * @module libs/core/src/identifier-mapping/testing
 */
import { DuplicateIdentifierMappingError } from '../../domain/exceptions/duplicate-identifier-mapping.error';
import { IdentifierMappingConflictException } from '../../domain/exceptions/identifier-mapping-conflict.exception';
import { InMemoryIdentifierMappingAdapter } from '../in-memory-identifier-mapping.adapter';

describe('InMemoryIdentifierMappingAdapter', () => {
  describe('getOrCreateInternalId', () => {
    it('should return a new ol_{prefix}_{uuid} internal ID on first call', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();

      const id = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-1');

      expect(id).toMatch(/^ol_product_[0-9a-f]{32}$/);
    });

    it('should be idempotent — return the same internal ID for the same (entityType, externalId, connectionId)', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      const first = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-1');

      const second = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-1');

      expect(second).toBe(first);
    });

    it('should honor the ENTITY_TYPE_ID_PREFIX override for ProductVariant', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();

      const id = await adapter.getOrCreateInternalId('ProductVariant', 'ext-v1', 'conn-1');

      expect(id).toMatch(/^ol_variant_[0-9a-f]{32}$/);
    });

    it('should mint distinct IDs for distinct (externalId, connectionId) pairs', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();

      const a = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-A');
      const b = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-B');
      const c = await adapter.getOrCreateInternalId('Product', 'ext-2', 'conn-A');

      expect(new Set([a, b, c]).size).toBe(3);
    });
  });

  describe('getInternalId', () => {
    it('should return null when no mapping exists', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();

      const id = await adapter.getInternalId('Product', 'ext-missing', 'conn-1');

      expect(id).toBeNull();
    });

    it('should return the internal ID when a mapping exists', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      const created = await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-1');

      const looked = await adapter.getInternalId('Product', 'ext-1', 'conn-1');

      expect(looked).toBe(created);
    });
  });

  describe('getExternalIds', () => {
    it('should return all external IDs mapped to a given internal ID across connections', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter({
        'conn-A': 'allegro',
        'conn-B': 'prestashop',
      });
      adapter.seed({ entityType: 'Product', externalId: 'ext-A', connectionId: 'conn-A', internalId: 'ol_product_x' });
      adapter.seed({ entityType: 'Product', externalId: 'ext-B', connectionId: 'conn-B', internalId: 'ol_product_x' });

      const externals = await adapter.getExternalIds('Product', 'ol_product_x');

      expect(externals).toHaveLength(2);
      expect(externals).toEqual(
        expect.arrayContaining([
          { externalId: 'ext-A', platformType: 'allegro', connectionId: 'conn-A', entityType: 'Product' },
          { externalId: 'ext-B', platformType: 'prestashop', connectionId: 'conn-B', entityType: 'Product' },
        ]),
      );
    });

    it('should default platformType to empty string when no connectionPlatformMap entry exists', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      adapter.seed({ entityType: 'Product', externalId: 'ext-1', connectionId: 'conn-1', internalId: 'ol_product_x' });

      const [external] = await adapter.getExternalIds('Product', 'ol_product_x');

      expect(external.platformType).toBe('');
    });
  });

  describe('getOrCreateExactMapping', () => {
    it('should be idempotent when the existing mapping matches the requested internalId', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      adapter.seed({ entityType: 'Product', externalId: 'ext-1', connectionId: 'conn-1', internalId: 'ol_product_x' });

      const returned = await adapter.getOrCreateExactMapping(
        'Product',
        'ext-1',
        'ol_product_x',
        'conn-1',
      );

      expect(returned).toBe('ext-1');
    });

    it('should throw IdentifierMappingConflictException when the externalId is mapped to a different internalId', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      adapter.seed({ entityType: 'Product', externalId: 'ext-1', connectionId: 'conn-1', internalId: 'ol_product_existing' });

      await expect(
        adapter.getOrCreateExactMapping('Product', 'ext-1', 'ol_product_requested', 'conn-1'),
      ).rejects.toBeInstanceOf(IdentifierMappingConflictException);
    });
  });

  describe('createMapping', () => {
    it('should throw DuplicateIdentifierMappingError on second insert with the same composite key', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      await adapter.createMapping('Product', 'ext-1', 'conn-1', 'ol_product_x');

      await expect(
        adapter.createMapping('Product', 'ext-1', 'conn-1', 'ol_product_y'),
      ).rejects.toBeInstanceOf(DuplicateIdentifierMappingError);
    });
  });

  describe('listExternalIdsByConnection', () => {
    it('should return all external IDs of an entityType for a single connection', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      adapter.seed({ entityType: 'Product', externalId: 'ext-1', connectionId: 'conn-A', internalId: 'ol_product_1' });
      adapter.seed({ entityType: 'Product', externalId: 'ext-2', connectionId: 'conn-A', internalId: 'ol_product_2' });
      adapter.seed({ entityType: 'Product', externalId: 'ext-3', connectionId: 'conn-B', internalId: 'ol_product_3' });
      adapter.seed({ entityType: 'Order', externalId: 'ord-1', connectionId: 'conn-A', internalId: 'ol_order_1' });

      const externals = await adapter.listExternalIdsByConnection('Product', 'conn-A');

      expect(externals.sort()).toEqual(['ext-1', 'ext-2']);
    });
  });

  describe('helpers', () => {
    it('should drop all rows on clear()', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();
      await adapter.getOrCreateInternalId('Product', 'ext-1', 'conn-1');

      adapter.clear();

      expect(await adapter.getInternalId('Product', 'ext-1', 'conn-1')).toBeNull();
    });

    it('should pre-populate without minting a new ID when seed() is used', async () => {
      const adapter = new InMemoryIdentifierMappingAdapter();

      adapter.seed({ entityType: 'Product', externalId: 'ext-1', connectionId: 'conn-1', internalId: 'ol_product_pre_seeded' });

      expect(await adapter.getInternalId('Product', 'ext-1', 'conn-1')).toBe('ol_product_pre_seeded');
    });
  });
});
