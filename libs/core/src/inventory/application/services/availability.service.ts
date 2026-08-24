/**
 * Availability Service (#2321, ADR-061)
 *
 * The computed available-to-promise path:
 * `max(0, Σ available[live] − Σ olReserved[published]) − buffer`, with the
 * provenance that says where the number came from.
 *
 * **Consumed by nobody in this wave.** The four shipped buffer sites
 * (`InventorySyncService`, `OfferBuilderService`, `ProductPublishBuilderService`,
 * the stock-at-risk read) still apply the buffer themselves; #2323 rewires them
 * onto this seam, and the exported parity fixture is the contract it checks
 * itself against.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IAvailabilityService}
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  isPresentButInvalidStockSafetyBuffer,
  readStockSafetyBuffer,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import {
  INVENTORY_REPOSITORY_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
} from '../../inventory.tokens';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import { ReservationLedgerReaderPort } from '../../domain/ports/reservation-ledger-reader.port';
import type {
  AvailabilityScope,
  PromisableQuantity,
} from '../../domain/types/availability.types';
import {
  computeAtp,
  toPromisableQuantity,
  unknownPromisableQuantity,
} from '../../domain/types/availability.types';
import { UnsupportedAvailabilityScopeError } from '../../domain/exceptions/unsupported-availability-scope.error';
import type {
  GetPromisableQuantitiesInput,
  IAvailabilityService,
} from './availability.service.interface';

@Injectable()
export class AvailabilityService implements IAvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(RESERVATION_LEDGER_READER_TOKEN)
    private readonly reservationLedger: ReservationLedgerReaderPort
  ) {}

  async getPromisableQuantities(
    input: GetPromisableQuantitiesInput
  ): Promise<readonly PromisableQuantity[]> {
    const { variantIds, scope } = input;
    const now = input.now ?? new Date();

    // Resolve the scope BEFORE any I/O so an unsupported scope fails the same
    // way whether or not the caller happened to pass an empty list.
    const buffer = await this.resolveBuffer(scope);

    if (variantIds.length === 0) return [];

    const rows = await this.inventoryRepository.findAvailabilityByVariantIds(variantIds);
    const byVariantId = new Map(rows.map((r) => [r.productVariantId, r]));

    let reserved: ReadonlyMap<string, number>;
    try {
      reserved = await this.reservationLedger.sumReservedByVariantIds({
        variantIds,
        scope,
        // ADR-061 decision 1: only holds stamped `published` reduce ATP.
        atpEffect: 'published',
      });
    } catch (error) {
      // BATCH-WIDE unknown. Never fall back to a zero ledger term: that
      // publishes the un-reserved quantity, which oversells by exactly the
      // outstanding holds — the failure mode reservations exist to prevent.
      this.logger.error(
        `availability_ledger_read_failed scope=${scope.kind} variants=${variantIds.length} — ` +
          `reporting provenance 'unknown' for the whole batch; callers must suppress the publish write`,
        (error as Error).stack
      );
      return variantIds.map((id) => unknownPromisableQuantity(id));
    }

    // Zero-fill in input order so the caller can build a Map directly without
    // re-walking its own list (the `getAvailabilityByVariantIds` idiom).
    return variantIds.map((id) => {
      const row = byVariantId.get(id);
      return toPromisableQuantity({
        productVariantId: id,
        quantity: computeAtp(row?.totalAvailable ?? 0, reserved.get(id) ?? 0, buffer),
        // A variant with no positions observed nothing — see
        // `toPromisableQuantity` for why that is a known zero, not an unknown.
        observedAt: row?.stockUpdatedAt ?? null,
        now,
      });
    });
  }

  /**
   * The buffer term, per scope (ADR-061 decision 3 — the buffer is a Control).
   *
   * `channel` reads the destination connection's own `stockSafetyBuffer`, which
   * is exactly what the four shipped publish sites do today; `global` applies
   * none, because the buffer is a per-destination cushion and there is no
   * defensible way to pick one connection's value to stand for every scope.
   */
  private async resolveBuffer(scope: AvailabilityScope): Promise<number> {
    switch (scope.kind) {
      case 'channel': {
        const connection = await this.connectionPort.get(scope.connectionId);
        if (isPresentButInvalidStockSafetyBuffer(connection.config)) {
          this.logger.warn(
            `Connection ${scope.connectionId} has a stockSafetyBuffer that is present but invalid ` +
              `(non-numeric, negative, zero, or non-finite) — it coerces to 0, so no stock ` +
              `reserve is applied. Set a positive integer to enable oversell protection.`
          );
        }
        return readStockSafetyBuffer(connection.config);
      }
      case 'global':
        return 0;
      case 'location':
      case 'order':
      case 'work':
        throw new UnsupportedAvailabilityScopeError(scope.kind);
    }
  }
}
