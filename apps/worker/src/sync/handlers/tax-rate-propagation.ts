/**
 * Tax-Rate Propagation (#2263, ADR-063)
 *
 * Pushes a rate the shop just changed onto the offers already selling under the
 * old one. Extracted from `MasterProductSyncHandler` when the batched sweep path
 * (#2593) gained a second caller: two copies of the "an Offer mapping's internal
 * id IS the variant id" rule would drift, and the rule is the whole reason a
 * per-variant change can address an offer at all.
 *
 * @module apps/worker/src/sync/handlers
 */

import type { JobEnqueuePort, SyncJobRequest } from '@openlinker/core/sync';
import type { MasterTaxRateChange } from '@openlinker/core/products';
import {
  CORE_ENTITY_TYPE,
  type IdentifierMappingQueryPort,
} from '@openlinker/core/identifier-mapping';
import type { Logger } from '@openlinker/shared/logging';

export interface TaxRatePropagationDeps {
  jobEnqueue: JobEnqueuePort;
  /** The narrow QUERY port: this only reads which offers a variant has. */
  identifierMapping: IdentifierMappingQueryPort;
  logger: Logger;
}

/**
 * Enqueue one offer-field write per (changed variant, marketplace connection).
 *
 * Best-effort per offer, and never throws: the catalogue write has already
 * committed, so one unreachable connection must not cost the others their
 * propagation nor re-run the sync that observed the change.
 *
 * The job runs on the MARKETPLACE connection the mapping names, never on the
 * master connection the sync was about - the two are different connections and
 * confusing them would dispatch the write against an adapter with no offers.
 */
export async function propagateTaxRateChanges(
  deps: TaxRatePropagationDeps,
  masterConnectionId: string,
  changes: readonly MasterTaxRateChange[]
): Promise<void> {
  if (changes.length === 0) return;

  for (const change of changes) {
    let mappings;
    try {
      mappings = await deps.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Offer,
        change.variantId
      );
    } catch (error) {
      deps.logger.warn(
        `Tax-rate propagation skipped - could not read the offer mappings for variant ${change.variantId}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    for (const mapping of mappings) {
      // Never back onto the master. A master connection carries no offers, so a
      // mapping naming it would be a data error rather than a target.
      if (mapping.connectionId === masterConnectionId) continue;
      const request: SyncJobRequest = {
        jobType: 'marketplace.offer.updateFields',
        connectionId: mapping.connectionId,
        payload: {
          schemaVersion: 1,
          offerId: change.variantId,
          // Rate-only, deliberately: the propagation states the one fact that
          // changed. Bundling price or title would make an unrelated edit ride
          // along on a tax correction.
          fields: { taxRate: change.taxRate },
        },
        // Keyed by the RATE, not by a timestamp or a run id. A repeat of the
        // same value dedups into a no-op (the sweep runs on a cron), while a
        // genuinely new rate mints a new key and gets through - which is exactly
        // the behaviour a run-scoped key would lose (#2039).
        idempotencyKey: `taxrate:${mapping.connectionId}:${change.variantId}:${change.taxRate}`,
      };
      try {
        await deps.jobEnqueue.enqueueJob(request);
        deps.logger.log(
          `Tax-rate propagation enqueued: variantId=${change.variantId} connectionId=${mapping.connectionId} taxRate=${change.taxRate}`
        );
      } catch (error) {
        deps.logger.warn(
          `Tax-rate propagation enqueue failed (the catalogue rate is stored; the next change re-enqueues): variantId=${change.variantId} connectionId=${mapping.connectionId} error=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
