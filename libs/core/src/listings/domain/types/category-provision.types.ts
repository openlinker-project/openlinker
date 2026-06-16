/**
 * Category Provision Types
 *
 * Command and result types for mirroring a source category path onto a shop
 * destination, creating any missing nodes, via
 * `CategoryProvisioner.provisionCategory`. This is ADR-023's placement step #1
 * made real (ADR-024 §2): only shops implement it — marketplaces map into a
 * fixed tree and can never *create* a category. Distinct from
 * `ProductMasterPort.assignCategories`, which only attaches a product to
 * already-existing categories.
 *
 * Naming: the verb-first `ProvisionCategoryCommand`/`ProvisionCategoryResult`
 * pair matches the `CreateOfferCommand`/`CreateOfferResult` precedent. ADR-024
 * §2's signature writes `CategoryProvisionResult` — the verb-first name used
 * here is canonical; the ADR wording is the outlier.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link CategoryProvisioner} for the capability that consumes these.
 */

/**
 * One node of a source category path, root → leaf.
 */
export interface ProvisionCategoryPathNode {
  /** Source-platform category id (provenance-bearing; e.g. a PrestaShop category id). */
  sourceCategoryId: string;
  /** Human-readable node name, used to create the node on the destination if missing. */
  name: string;
}

/**
 * Command to mirror a source category path onto a shop destination,
 * create-if-missing and hierarchical.
 */
export interface ProvisionCategoryCommand {
  /** Target shop connection id. */
  connectionId: string;
  /**
   * The category path to mirror, ordered root → leaf. The adapter walks the
   * path, creating any node absent on the destination (e.g. WooCommerce
   * `POST products/categories` with `parent`), and returns the leaf id.
   */
  path: ProvisionCategoryPathNode[];
}

/**
 * Result returned by `CategoryProvisioner.provisionCategory`.
 */
export interface ProvisionCategoryResult {
  /** Destination category id of the resolved leaf node. */
  destinationCategoryId: string;
  /**
   * Destination ids of nodes that were created during this call (as opposed to
   * matched to existing nodes). Observability only; omitted when nothing was
   * created.
   */
  createdPath?: string[];
}
