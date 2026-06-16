/**
 * Identifier Mapping Types — unit tests
 *
 * Regression guards for the open-`EntityType` extension axis (#577). The
 * well-known core list (`CoreEntityTypeValues`) stays closed; port boundary
 * signatures accept arbitrary strings. The internal-ID prefix override map
 * keeps its `Partial<Record<CoreEntityType, string>>` shape — plugin entity
 * types fall through to the lowercased default.
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import type { IdentifierMappingRequest } from '../identifier-mapping.types';
import { CoreEntityTypeValues, ENTITY_TYPE_ID_PREFIX } from '../identifier-mapping.types';

describe('identifier-mapping.types', () => {
  describe('CoreEntityTypeValues', () => {
    it('should expose the documented well-known entity types', () => {
      // Guards against silent reordering or accidental additions/removals
      // of the published well-known set. The architecture doc enumerates
      // the same values at §"Internal Identifier Format". `Shipment`
      // joined in #763 (foundation slice for the InPost shipping epic);
      // `ShopProduct` joined in #1042 (variant→destination-product key for
      // the shop-publish vertical).
      expect([...CoreEntityTypeValues]).toEqual([
        'Product',
        'ProductVariant',
        'Sku',
        'Order',
        'Offer',
        'Inventory',
        'Customer',
        'Shipment',
        'ShopProduct',
      ]);
    });
  });

  describe('ENTITY_TYPE_ID_PREFIX', () => {
    it('should override the prefix to "variant" for ProductVariant', () => {
      // Documented in architecture-overview.md §"Internal Identifier Format":
      // ProductVariant maps to ol_variant_*, not ol_productvariant_*.
      expect(ENTITY_TYPE_ID_PREFIX.ProductVariant).toBe('variant');
    });

    it('should not register an override for Product (default lowercased prefix wins)', () => {
      expect(ENTITY_TYPE_ID_PREFIX.Product).toBeUndefined();
    });
  });

  describe('prefix lookup at the open boundary', () => {
    // Mirrors the lookup in IdentifierMappingService.generateInternalId.
    // Documents that plugin-registered entity types (which #577 unblocks)
    // fall through to the lowercased default cleanly — without the cast
    // hacks the closed-set version required.
    function resolvePrefix(entityType: string): string {
      const overrides: Record<string, string | undefined> = ENTITY_TYPE_ID_PREFIX;
      return overrides[entityType] ?? entityType.toLowerCase();
    }

    it('should return "variant" for the ProductVariant override', () => {
      expect(resolvePrefix('ProductVariant')).toBe('variant');
    });

    it('should fall back to lowercased entityType for well-known types without overrides', () => {
      expect(resolvePrefix('Product')).toBe('product');
      expect(resolvePrefix('Offer')).toBe('offer');
      expect(resolvePrefix('Customer')).toBe('customer');
      // #763 — Shipment uses the default lowercase fallback (ol_shipment_*).
      expect(resolvePrefix('Shipment')).toBe('shipment');
    });

    it('should fall back to lowercased entityType for plugin-registered types', () => {
      // The whole point of #577: a Shopify or Klarna adapter mapping a
      // Refund / Fulfilment / Subscription doesn't need a core PR, and
      // gets a sensible default prefix.
      expect(resolvePrefix('Refund')).toBe('refund');
      expect(resolvePrefix('Fulfilment')).toBe('fulfilment');
      expect(resolvePrefix('Subscription')).toBe('subscription');
    });
  });

  describe('IdentifierMappingRequest.entityType', () => {
    it('should accept a well-known core entity type', () => {
      const request: IdentifierMappingRequest = {
        entityType: 'Product',
        externalId: 'ext-1',
        connectionId: 'conn-1',
      };
      expect(request.entityType).toBe('Product');
    });

    it('should accept a plugin-registered entity type beyond the core set', () => {
      // Documents the open extension axis at the request boundary —
      // matches the architecture-overview.md interface excerpt
      // `entityType: 'Product' | … | 'Customer' | string`.
      const request: IdentifierMappingRequest = {
        entityType: 'Refund',
        externalId: 'ext-2',
        connectionId: 'conn-1',
      };
      expect(request.entityType).toBe('Refund');
    });
  });
});
