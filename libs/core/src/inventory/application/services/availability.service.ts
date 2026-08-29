/**
 * Availability Service (#2321, ADR-061)
 *
 * The computed available-to-promise path:
 * `max(0, Σ available[live] − Σ olReserved[published]) − buffer`, with the
 * provenance that says where the number came from.
 *
 * **This service is now the sole owner of the `stockSafetyBuffer` helpers**
 * (#2323). The four shipped buffer sites — `InventorySyncService`, the two
 * publish builders and the stock-at-risk read — used to each keep a private
 * copy of the read-warn-apply sequence; they now call `applyPublishControls`
 * (or, for display only, `getAppliedReserve`) and the arithmetic lives here.
 * The exported parity fixture is the contract that rewire is checked against.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IAvailabilityService}
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionPort,
  applyStockSafetyBuffer,
  isPresentButInvalidStockSafetyBuffer,
  isPresentButInvalidStockZeroThreshold,
  readStockSafetyBuffer,
  readStockZeroThreshold,
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
  PublishControls,
} from '../../domain/types/availability.types';
import {
  applyScopedLedgerSubtraction,
  toPromisableQuantity,
  unknownPromisableQuantity,
} from '../../domain/types/availability.types';
import { UnsupportedAvailabilityScopeError } from '../../domain/exceptions/unsupported-availability-scope.error';
import type {
  ApplyPublishControlsBatchInput,
  ApplyPublishControlsInput,
  ControlledQuantity,
  GetPromisableQuantitiesInput,
  IAvailabilityService,
  PublishControlResult,
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
    //
    // Wrapped in the SAME catch `applyPublishControls` uses: a channel Control
    // read that throws here used to escape as a 500, so the batch-wide
    // 'unknown' this method already implements for a ledger failure was
    // unreachable for the OTHER of its two dependencies — and the callers'
    // stock-at-risk arm with it.
    let controls: PublishControls;
    try {
      controls = await this.resolvePublishControls(scope);
    } catch (error) {
      // An unsupported scope is a CALLER BUG and must keep throwing (see
      // `applyPublishControls` and UnsupportedAvailabilityScopeError).
      if (error instanceof UnsupportedAvailabilityScopeError) throw error;
      this.logger.error(
        `availability_controls_read_failed scope=${scope.kind} variants=${variantIds.length} — ` +
          `reporting provenance 'unknown' for the whole batch; callers must suppress the publish write`,
        (error as Error).stack
      );
      return variantIds.map((id) => unknownPromisableQuantity(id));
    }

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
        // `'computed'` is the ONLY value Wave 2 can produce: no dispatched
        // `AvailabilityAuthority` adapter exists. This is the single Wave-3 flip
        // point — resolving an authority for the scope, passing `'authority'`
        // with its answer, and letting `applyScopedLedgerSubtraction` report
        // OL's holds as `olHeldNotReflected` instead of subtracting them.
        provenance: 'computed',
        atp: applyScopedLedgerSubtraction(
          // A variant with no positions observed nothing — see
          // `toPromisableQuantity` for why that is a known zero, not an unknown.
          { answeredBy: 'computed', totalAvailable: row?.totalAvailable ?? 0 },
          reserved.get(id) ?? 0,
          controls.buffer,
          controls.zeroThreshold
        ),
        observedAt: row?.stockUpdatedAt ?? null,
        now,
      });
    });
  }

  async applyPublishControls(input: ApplyPublishControlsInput): Promise<PublishControlResult> {
    const { quantity, scope } = input;

    let controls: PublishControls;
    try {
      controls = await this.resolvePublishControls(scope);
    } catch (error) {
      // An unsupported scope is a CALLER BUG and must keep throwing — dressing
      // it as `'unknown'` would send an operator hunting a healthy integration
      // (see UnsupportedAvailabilityScopeError). Only a genuine failure to read
      // the Controls degrades.
      if (error instanceof UnsupportedAvailabilityScopeError) throw error;
      this.logger.error(
        `availability_controls_read_failed scope=${scope.kind} — reporting provenance ` +
          `'unknown'; the caller must suppress its publish write rather than publish ` +
          `the unbuffered quantity`,
        (error as Error).stack
      );
      return { quantity: null, provenance: 'unknown' };
    }

    // Byte-identical to what the four shipped publish sites did before #2323.
    return {
      quantity: applyStockSafetyBuffer(
        Math.max(0, quantity),
        controls.buffer,
        controls.zeroThreshold
      ),
      provenance: 'computed',
    };
  }

  async applyPublishControlsBatch(
    input: ApplyPublishControlsBatchInput
  ): Promise<readonly ControlledQuantity[]> {
    const { quantities, scope } = input;

    let controls: PublishControls;
    try {
      controls = await this.resolvePublishControls(scope);
    } catch (error) {
      if (error instanceof UnsupportedAvailabilityScopeError) throw error;
      this.logger.error(
        `availability_controls_read_failed scope=${scope.kind} quantities=${quantities.length} — ` +
          `reporting provenance 'unknown' for the whole batch; the caller must suppress its ` +
          `publish writes rather than publish the unbuffered quantities`,
        (error as Error).stack
      );
      return quantities.map(() => ({ quantity: null, provenance: 'unknown' as const }));
    }

    // The arithmetic is IDENTICAL to `applyPublishControls`; only the Control
    // resolution is hoisted. Per-item resolution put one connection read per
    // ITEM on the hottest write path in the system, where the pre-#2323 code
    // did one per BATCH — a batch of N offers reading the same connection N
    // times for a value that cannot change within the batch.
    return quantities.map((quantity) => ({
      quantity: applyStockSafetyBuffer(
        Math.max(0, quantity),
        controls.buffer,
        controls.zeroThreshold
      ),
      provenance: 'computed' as const,
    }));
  }

  async getAppliedReserve(scope: AvailabilityScope): Promise<number> {
    return (await this.resolvePublishControls(scope)).buffer;
  }

  /**
   * The connection's publish policy, per scope (ADR-061 decision 3 — both knobs
   * are Controls).
   *
   * `channel` reads the destination connection's own `stockSafetyBuffer` AND its
   * `stockZeroThreshold` (#2610), which together are exactly what the four
   * shipped publish sites applied before #2323 centralised them here. Resolving
   * only the buffer would leave the threshold configurable and inert on every
   * publish path — the knob would be in the UI and change nothing.
   *
   * `global` applies neither, because both are per-destination cushions and
   * there is no defensible way to pick one connection's value to stand for
   * every scope.
   */
  private async resolvePublishControls(scope: AvailabilityScope): Promise<PublishControls> {
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
        if (isPresentButInvalidStockZeroThreshold(connection.config)) {
          this.logger.warn(
            `Connection ${scope.connectionId} has a stockZeroThreshold that is present but invalid ` +
              `(non-numeric, negative, or non-finite) — it coerces to 0, so the threshold is off ` +
              `and low stock is published as its real number. Set a positive integer to enable it.`
          );
        }
        return {
          buffer: readStockSafetyBuffer(connection.config),
          zeroThreshold: readStockZeroThreshold(connection.config),
        };
      }
      case 'global':
        return { buffer: 0, zeroThreshold: 0 };
      case 'location':
      case 'order':
      case 'work':
        throw new UnsupportedAvailabilityScopeError(scope.kind);
    }
  }
}
