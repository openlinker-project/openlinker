/**
 * Price Sync Mode Override Service (#3162 review)
 *
 * The ONE place that writes `Connection.config.priceSyncMode` on the
 * accept/edit/bulk-accept "opt this source into automatic" path.
 *
 * `PriceChangesService` (core, `libs/core/src/listings`) used to perform
 * this write itself, directly through `ConnectionPort` — the only core
 * service in the tree that writes `Connection.config` at all; every other
 * core service holding `CONNECTION_PORT_TOKEN` only reads. That skipped
 * `IConnectionService`'s validation (`validateStockAndPricingConfig` /
 * `validateConfigShape`) and, because `ConnectionRepository.update` is a
 * full-row read-modify-write `save()` with no lock or version guard, opened
 * a lost-update race: an operator saving the connection's Pricing & sync
 * settings page concurrently with an accept-with-opt-in could have their
 * edit silently reverted, and `bulkAccept` performed this read-modify-write
 * once PER EPISODE in a loop, widening the window considerably.
 *
 * `IConnectionService` is an APP-LAYER construct
 * (`apps/api/src/integrations`) — a core service cannot depend on it
 * without inverting the core→app dependency direction, so the write moved
 * here, to `apps/api`, where the HTTP controller already lives.
 *
 * @module apps/api/src/listings/application/services
 * @implements {IPriceSyncModeOverrideService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { readPriceSyncModeConfig, type ConnectionConfig } from '@openlinker/core/identifier-mapping';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import type { PriceChangeConnectionPair } from '@openlinker/core/listings';
import type {
  IPriceSyncModeOverrideService,
  PriceSyncModeOverrideOutcome,
} from './price-sync-mode-override.service.interface';

/**
 * Lock TTL — sized to comfortably exceed a `get` + `update` round trip.
 * Mirrors `INVOICE_ISSUE_LOCK_TTL_MS`'s reasoning: the lock closes the
 * read-modify-write race, while its own expiry is not a correctness cliff
 * (the write either landed or it didn't; there is no partial state for a
 * heartbeat to protect).
 */
const PRICE_SYNC_MODE_LOCK_TTL_MS = 15_000;

@Injectable()
export class PriceSyncModeOverrideService implements IPriceSyncModeOverrideService {
  private readonly logger = new Logger(PriceSyncModeOverrideService.name);

  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort
  ) {}

  async setSourceOverrideAutomatic(pair: PriceChangeConnectionPair): Promise<boolean> {
    const { destinationConnectionId, sourceConnectionId } = pair;
    const lockKey = `pricing:sync-mode:${destinationConnectionId}`;
    const token = await this.lock.acquire(lockKey, PRICE_SYNC_MODE_LOCK_TTL_MS);
    if (!token) {
      this.logger.warn(
        `[price-sync-mode] could not acquire lock for connection ${destinationConnectionId} — skipping opt-in (${sourceConnectionId} -> ${destinationConnectionId})`
      );
      return false;
    }

    try {
      const connection = await this.connections.get(destinationConnectionId);
      const existing = readPriceSyncModeConfig(connection.config);
      const updatedConfig: ConnectionConfig = {
        ...connection.config,
        priceSyncMode: {
          default: existing.default,
          sourceOverrides: { ...existing.sourceOverrides, [sourceConnectionId]: 'automatic' },
        },
      };
      // Goes through `IConnectionService.update`, which re-runs
      // `validateStockAndPricingConfig` (the #2610 margin/priceSyncMode
      // shape check) before persisting.
      await this.connections.update(destinationConnectionId, { config: updatedConfig });
      return true;
    } catch (error) {
      this.logger.warn(
        `[price-changes] failed to opt (${sourceConnectionId} -> ${destinationConnectionId}) into automatic mode: ${(error as Error).message}`
      );
      return false;
    } finally {
      try {
        await this.lock.release(lockKey, token);
      } catch {
        // Best-effort — the lock's own TTL is the backstop.
      }
    }
  }

  async setSourceOverridesAutomatic(
    pairs: readonly PriceChangeConnectionPair[]
  ): Promise<readonly PriceSyncModeOverrideOutcome[]> {
    const outcomes: PriceSyncModeOverrideOutcome[] = [];
    for (const pair of pairs) {
      const applied = await this.setSourceOverrideAutomatic(pair);
      outcomes.push({ ...pair, applied });
    }
    return outcomes;
  }
}
