/**
 * Inventory Provenance Backfill Service
 *
 * ADR-058 ladder step (ii) (#2317) — the `'legacy'` sentinel backfill, one
 * bounded page per call.
 *
 * Deliberately thin. The interesting decisions live on either side of it: the
 * SQL that stamps a page without moving `updatedAt` is the repository's
 * (`backfillLegacyProvenance`), and the bounding, locking, latching and
 * cadence are the worker handler's. What belongs here is the one thing neither
 * of those can own — the completion PREDICATE, which is a domain statement
 * about when the table is ready for step (iii), not an artefact of how the
 * sweep is scheduled.
 *
 * The count is taken unconditionally after every page rather than only when a
 * page comes back short. It is a single indexless count of one column's NULLs
 * on a table already being scanned; paying it every tick buys an
 * always-current `remainingNull` for the operator and for #2325, and removes
 * the "did we finish?" question from the handler entirely.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IInventoryProvenanceBackfillService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type {
  IInventoryProvenanceBackfillService,
  InventoryProvenanceBackfillResult,
} from './inventory-provenance-backfill.service.interface';

@Injectable()
export class InventoryProvenanceBackfillService implements IInventoryProvenanceBackfillService {
  private readonly logger = new Logger(InventoryProvenanceBackfillService.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly repository: InventoryRepositoryPort
  ) {}

  async runPage(limit: number): Promise<InventoryProvenanceBackfillResult> {
    const stamped = await this.repository.backfillLegacyProvenance(limit);
    const remainingNull = await this.repository.countMissingProvenance();

    if (stamped === 0 && remainingNull > 0) {
      // Every candidate row was locked by a concurrent writer and skipped. Not
      // a failure and not a completion — the next tick collects them. Logged
      // because a run of these would mean the backfill is being starved by
      // sustained write pressure, which an operator can answer by moving the
      // cron off the busy window.
      this.logger.warn(
        `Inventory provenance backfill stamped no rows while ${String(remainingNull)} remain — ` +
          `every candidate row was locked by a concurrent write; retrying next tick`
      );
    }

    return {
      stamped,
      remainingNull,
      // See the interface docblock: zero REMAINING is the finish line, never
      // zero stamped.
      completed: remainingNull === 0,
    };
  }
}
