/**
 * Return Re-attribution Service Interface
 *
 * The `returns` context's third pass (#2332, ADR-060): re-check OL's own orphan returns
 * against `identifier_mappings` and attribute the ones whose order has since been
 * ingested.
 *
 * @module libs/core/src/returns/application/services
 */
import type {
  ReturnReattributionOptions,
  ReturnReattributionResult,
} from '../../domain/types/return-reattribution.types';

export interface IReturnReattributionService {
  /**
   * Re-check one bounded page of a connection's orphan returns.
   *
   * **This pass can never fail ingestion, structurally.** It is its own job type on its
   * own lane with its own cron, reached through this service and nothing else — no
   * ingestion path calls it, and none may start to: a call from
   * `IReturnsService.upsertFromObservation` would be a contract break, not a refactor,
   * because it would make a return's persistence able to fail on a reconcile fault.
   * Within the page, a per-row write fault is caught and counted rather than abandoning
   * the remaining candidates.
   *
   * **What is NOT caught, and why.** A failure to resolve the CONNECTION propagates.
   * `IIdentifierMappingService.getInternalId` reads the `Connection` to derive
   * `platformType` and throws when it is gone; `ReturnsService.resolveInternalOrderId`
   * documents that exact case and deliberately leaves it uncaught, because a connection
   * deleted mid-run is a real failure the job must surface. Catching it per candidate
   * would launder it into `failed: N` on every page, every tick, forever, with nothing
   * above `warn`.
   */
  reconcile(
    connectionId: string,
    options: ReturnReattributionOptions
  ): Promise<ReturnReattributionResult>;
}
