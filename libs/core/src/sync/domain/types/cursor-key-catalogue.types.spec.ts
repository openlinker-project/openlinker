/**
 * Cursor Key Catalogue Unit Tests (#4023)
 */
import {
  OFFER_QUANTITY_WRITE_MARK_PREFIX,
  catalogueWriterJobTypes,
  resolveCursorCatalogueEntry,
} from './cursor-key-catalogue.types';
import { masterSweepCompletedAtCursorKey, masterSweepCursorKey } from './master-sweep-cursor.types';

describe('resolveCursorCatalogueEntry', () => {
  it.each([
    ['allegro.orders.lastEventId', 'event-bookmark', 'marketplace.orders.poll', null],
    ['prestashop.orders.dateUpd', 'event-bookmark', 'marketplace.orders.poll', null],
    ['erli.orders.inboxCursor', 'event-bookmark', 'marketplace.orders.poll', null],
    ['allegro.offerStatus.scanOffset', 'rolling-offset', 'marketplace.offer.statusSync', 'restart-check'],
    ['inpost.shipmentStatus.scanOffset', 'rolling-offset', 'marketplace.shipment.statusSync', 'restart-check'],
    [masterSweepCursorKey('product', 'c1'), 'sweep-cycle', 'master.product.syncAll', 'restart-pass'],
    [masterSweepCursorKey('inventory', 'c1'), 'sweep-cycle', 'master.inventory.syncAll', 'restart-pass'],
    [masterSweepCursorKey('product-reconcile', 'c1'), 'sweep-cycle', 'master.product.reconcile', 'restart-pass'],
    [masterSweepCompletedAtCursorKey('product', 'c1'), 'completion-stamp', null, null],
    [`${OFFER_QUANTITY_WRITE_MARK_PREFIX}9`, 'write-order', null, null],
  ])('should classify %s', (key, family, writerJobType, rewind) => {
    expect(resolveCursorCatalogueEntry(key)).toEqual({ family, writerJobType, rewind });
  });

  it('should return null when the key is not recognised', () => {
    expect(resolveCursorCatalogueEntry('custom.plugin.cursor')).toBeNull();
  });

  it('should never offer a rewind on an order feed when the cursor format belongs to the adapter', () => {
    expect(resolveCursorCatalogueEntry('prestashop.orders.dateUpd')?.rewind).toBeNull();
    expect(resolveCursorCatalogueEntry('allegro.orders.lastEventId')?.rewind).toBeNull();
  });

  it('should list each writer job type once', () => {
    const types = catalogueWriterJobTypes();
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain('marketplace.orders.poll');
  });
});
