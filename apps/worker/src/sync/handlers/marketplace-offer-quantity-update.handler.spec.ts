/**
 * Marketplace Offer Quantity Update Handler Tests
 *
 * Covers the payload contract for the observation token threaded into the derived
 * idempotency key (#2285) — accepted only as a string, never fatal when absent or
 * malformed, since V1 payloads in flight predate the field.
 *
 * @module apps/worker/src/sync/handlers
 */

import { MarketplaceOfferQuantityUpdateHandler } from './marketplace-offer-quantity-update.handler';
import type { IInventorySyncService } from '@openlinker/core/inventory';
import type { SyncJob } from '@openlinker/core/sync';

describe('MarketplaceOfferQuantityUpdateHandler', () => {
  let handler: MarketplaceOfferQuantityUpdateHandler;
  let inventorySync: jest.Mocked<IInventorySyncService>;

  const job = (payload: Record<string, unknown>): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'marketplace.offerQuantity.update',
      connectionId: 'conn-1',
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    inventorySync = {
      updateOfferQuantity: jest.fn().mockResolvedValue({ succeeded: ['o1'], failed: [] }),
      updateOfferQuantities: jest.fn(),
    } as unknown as jest.Mocked<IInventorySyncService>;

    handler = new MarketplaceOfferQuantityUpdateHandler(inventorySync);
  });

  it('should thread a string observedAt from the payload into the core command', async () => {
    const result = await handler.execute(
      job({
        schemaVersion: 1,
        offerId: 'o1',
        quantity: 0,
        observedAt: '2026-08-01T00:00:00.000Z',
      })
    );

    expect(inventorySync.updateOfferQuantity).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ observedAt: '2026-08-01T00:00:00.000Z' })
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('should execute a payload carrying no observedAt', async () => {
    const result = await handler.execute(job({ schemaVersion: 1, offerId: 'o1', quantity: 4 }));

    expect(inventorySync.updateOfferQuantity).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ offerId: 'o1', quantity: 4, observedAt: undefined })
    );
    expect(result).toEqual({ outcome: 'ok' });
  });

  it.each([[null], [12345], [{ at: 'x' }]])(
    'should coerce a non-string observedAt (%p) to absent rather than fail the job',
    async (observedAt) => {
      const result = await handler.execute(
        job({ schemaVersion: 1, offerId: 'o1', quantity: 4, observedAt })
      );

      expect(inventorySync.updateOfferQuantity).toHaveBeenCalledWith(
        'conn-1',
        expect.objectContaining({ observedAt: undefined })
      );
      expect(result).toEqual({ outcome: 'ok' });
    }
  );
});
