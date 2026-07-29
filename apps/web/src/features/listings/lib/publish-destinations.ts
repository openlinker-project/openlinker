/**
 * Publish destinations (#1828)
 *
 * Capability-driven classification of the connections a product can be
 * *published* to, spanning both kinds of destination the unified "Publish
 * products" flow surfaces:
 *   - **marketplaces** — connections advertising the `OfferCreator`
 *     sub-capability (offer creation, e.g. Allegro / Erli), and
 *   - **online shops** — connections that have *enabled* the
 *     `ProductPublisher` capability (a `ShopProductManagerPort`, ADR-024,
 *     e.g. WooCommerce), which is config-gated and therefore keyed off
 *     `enabledCapabilities`, not `supportedCapabilities`.
 *
 * The kind is resolved purely from capabilities — never from a
 * `platformType` literal — so the grouped destination rail and the entry
 * eligibility filters stay marketplace/shop-agnostic and open to future
 * plugins.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { Connection } from '../../connections';

/** The two destination kinds the unified publish rail groups by. */
export type PublishDestinationKind = 'marketplace' | 'shop';

/** Capability that marks a connection as an offer-creating marketplace. */
export const MARKETPLACE_PUBLISH_CAPABILITY = 'OfferCreator';
/** Capability that marks a connection as a product-publishing online shop. */
export const SHOP_PUBLISH_CAPABILITY = 'ProductPublisher';

/** A publish-eligible connection paired with its resolved kind. */
export interface PublishDestination {
  connection: Connection;
  kind: PublishDestinationKind;
}

/** Short, capability-driven hint rendered under each destination's name. */
export const PUBLISH_DESTINATION_KIND_HINT: Record<PublishDestinationKind, string> = {
  marketplace: 'Offer marketplace',
  shop: 'Online shop',
};

/** Group heading for the destination rail, per kind. */
export const PUBLISH_DESTINATION_GROUP_LABEL: Record<PublishDestinationKind, string> = {
  marketplace: 'Marketplaces',
  shop: 'Online shops',
};

/** Stable rail order: marketplaces first, then shops. */
export const PUBLISH_DESTINATION_KIND_ORDER: readonly PublishDestinationKind[] = [
  'marketplace',
  'shop',
];

/**
 * Resolve a connection's publish-destination kind, or `null` when it can be
 * neither published-as-offer nor published-as-shop-product. Marketplace
 * (offer creation) wins when a connection somehow advertises both.
 */
export function publishDestinationKind(connection: Connection): PublishDestinationKind | null {
  if (connection.supportedCapabilities?.includes(MARKETPLACE_PUBLISH_CAPABILITY)) {
    return 'marketplace';
  }
  if (connection.enabledCapabilities?.includes(SHOP_PUBLISH_CAPABILITY)) {
    return 'shop';
  }
  return null;
}

/**
 * Active connections eligible for the unified publish flow (marketplace OR
 * shop), each tagged with its kind, sorted by kind (marketplaces first) then
 * name for a stable rail order.
 */
export function selectPublishDestinations(
  all: readonly Connection[],
): PublishDestination[] {
  return all
    .filter((c) => c.status === 'active')
    .map((c) => ({ connection: c, kind: publishDestinationKind(c) }))
    .filter((d): d is PublishDestination => d.kind !== null)
    .sort((a, b) => {
      const kindDelta =
        PUBLISH_DESTINATION_KIND_ORDER.indexOf(a.kind) -
        PUBLISH_DESTINATION_KIND_ORDER.indexOf(b.kind);
      if (kindDelta !== 0) return kindDelta;
      return a.connection.name.localeCompare(b.connection.name);
    });
}

/**
 * Resolve which destination is the active pick: auto-resolves when exactly
 * one destination is eligible, otherwise falls back to the operator's own
 * pick (or `null`/`null` when nothing is eligible or nothing picked yet).
 */
export function resolvePublishDestination(
  destinations: readonly PublishDestination[],
  pickedConnectionId: string,
): { resolvedConnectionId: string | null; resolvedKind: PublishDestinationKind | null } {
  const resolvedConnectionId =
    destinations.length === 1 ? destinations[0].connection.id : pickedConnectionId || null;
  const resolvedDestination =
    resolvedConnectionId !== null
      ? destinations.find((d) => d.connection.id === resolvedConnectionId) ?? null
      : null;
  return {
    resolvedConnectionId,
    resolvedKind: resolvedDestination?.kind ?? null,
  };
}
