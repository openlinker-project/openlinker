/**
 * Inventory Location Bootstrap Vocabulary (#2407)
 *
 * The starting location an operator is *offered* on first run, so that the
 * fulfilment-routing enablement guard can refuse with a remedy rather than with
 * a dead end. Routing needs locations, and `inventory_locations` (ADR-058
 * decision 1, #2313) ships empty on every install with nothing seeding it.
 *
 * **This is an offer, never a seed.** Nothing here is written by a migration and
 * nothing here is written as a side effect of creating or enabling a connection
 * — an operator asks for it. Minting on enable would make the zero-location
 * refusal unreachable, which is the whole point of the guard.
 *
 * **A bootstrapped row is not a stand-in for an unlocated position.**
 * `inventory-location.entity.ts` records that `locationId IS NULL` permanently
 * means "the master declines to locate its stock" (ADR-058 decision 2) and that
 * no row here is ever a stand-in for that NULL. Minting `MAIN` therefore locates
 * no existing stock; it satisfies the precondition and nothing more.
 *
 * @module libs/core/src/inventory/domain/types
 * @see docs/architecture/adrs/058-multi-location-positions-reservations-availability-authority.md
 */
import type { InventoryLocation } from '../entities/inventory-location.entity';
import type { CreateInventoryLocationInput } from './location.types';

/**
 * What the first run offers to mint.
 *
 * Exactly one row, deliberately. The alternative considered was one location per
 * distinct `inventory_items.sourceConnectionId`, which needs a new repository
 * read, mints rows the operator never asked for, and *still* attaches no stock —
 * so it guesses at a warehouse topology from a provenance column while buying no
 * routing correctness over this single row.
 *
 * Geo columns are left `null` on purpose: the router's `country-served` /
 * `nearest` filters read them, and a fabricated country would be worse than an
 * absent one. The operator fills them in on a row that is theirs to edit.
 *
 * `status` MUST stay `'active'` — see `ILocationService.countActiveLocations`,
 * whose filter this is coupled to.
 */
export const BOOTSTRAP_LOCATION_SPECS: readonly CreateInventoryLocationInput[] = Object.freeze([
  Object.freeze({
    code: 'MAIN',
    name: 'Main warehouse',
    kind: 'warehouse',
    status: 'active',
  }) as CreateInventoryLocationInput,
]);

/**
 * What a bootstrap run did.
 *
 * **`existingCodes` carries codes, not entities, and that is forced by the
 * contract rather than chosen.** There is no code-keyed read on
 * `LocationRepositoryPort` or `ILocationService`, and the only reachable
 * substitute — `listLocations({ codePrefix })` — is a *case-insensitive prefix*
 * match, so resolving `'MAIN'` would also match an operator's `MAIN-2` or
 * `main-warehouse-eu` and report the wrong row as the one that already existed.
 * Adding a port method to return a value no caller needs would be the worse
 * trade: the only question a caller has is whether anything was minted.
 */
export interface LocationBootstrapResult {
  /** Rows this run actually created. Empty on every run after the first. */
  readonly created: readonly InventoryLocation[];
  /** Codes that were already present, so this run left them untouched. */
  readonly existingCodes: readonly string[];
}
