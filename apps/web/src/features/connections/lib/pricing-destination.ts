/**
 * "Is this connection a viable pricing destination?" — one predicate, four
 * callers (#3166 round-3 review).
 *
 * It was spelled four times before: `EditConnectionForm`'s
 * `needsMasterCatalog`, `ConnectionPricingSyncPage`'s
 * `DESTINATION_CAPABILITIES`, an inline check on the connection detail page,
 * and transitively the `pricingRuleManagedElsewhere` flag passed into
 * `StockAndPricingSection`. They agreed — but #3166 made a disagreement
 * DESTRUCTIVE rather than merely inconsistent: `EditConnectionForm.onSubmit`
 * DELETES `config.pricingRule` for the population it considers a destination,
 * while the only editor that can restore one renders for the population the
 * pricing-sync page considers a destination. Widen one and not the other and
 * a connection silently loses its pricing rule on any unrelated save, with no
 * editor anywhere to put it back and nothing logged.
 *
 * The capability set is the same one the publish flow already keys on: a
 * marketplace lists offers (`OfferManager`), a shop publishes products
 * (`ProductPublisher`), and both resolve their price through
 * `config.pricingRule` in their respective builders. Capability-driven, never
 * `platformType` — `docs/frontend-architecture.md` § Platform Plugins.
 *
 * @module apps/web/src/features/connections/lib
 */

/** The capabilities that make a connection a pricing destination. */
export const PRICING_DESTINATION_CAPABILITIES = ['OfferManager', 'ProductPublisher'] as const;

/**
 * True when the connection publishes a price OpenLinker resolves — i.e. when
 * `config.pricingRule` and the pricing & sync settings apply to it.
 */
export function isPricingDestination(connection: {
  enabledCapabilities: readonly string[];
}): boolean {
  return PRICING_DESTINATION_CAPABILITIES.some((capability) =>
    connection.enabledCapabilities.includes(capability),
  );
}

/**
 * True when `/connections/:id/pricing-sync` has anything to show for this
 * connection — i.e. when the detail page should offer the link.
 *
 * WIDER than `isPricingDestination` on purpose (#3167 round-3 review): that
 * page renders the editable settings for a DESTINATION *and* the read-only
 * "how your prices get adjusted" rollup for a SOURCE. Gating the button on
 * the destination half alone left a `ProductMaster`-only connection unable to
 * reach its own rollup from its own detail page — the surface #3150 exists
 * to give it.
 */
export function hasPricingSyncPage(connection: {
  enabledCapabilities: readonly string[];
}): boolean {
  return isPricingDestination(connection) || connection.enabledCapabilities.includes('ProductMaster');
}
