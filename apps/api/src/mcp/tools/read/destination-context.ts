/**
 * Destination Context Resolution (MCP mapping tools, #1488)
 *
 * Resolves the two facts the category-resolution and attribute-projection
 * services need about a destination but cannot derive themselves:
 *
 *  1. WHICH CAPABILITY exposes its live category schema. A marketplace serves
 *     it under `OfferManager`; a shop serves it under `ProductPublisher` and
 *     does NOT support `OfferManager` at all — resolving the wrong one throws
 *     `CapabilityNotSupportedException` (see `ProductPublishBuilderService`,
 *     which hardcodes `'ProductPublisher'` for exactly this reason).
 *  2. WHETHER IT BORROWS a taxonomy (#1045). A borrowing destination (Erli)
 *     reuses the owner's (Allegro's) category + attribute mappings verbatim.
 *     Omitting this makes `resolve_category` report `manual` for a connection
 *     whose operator already has a working owner-authored mapping — a silent
 *     wrong answer that would make an agent author a redundant row.
 *
 * `OfferBuilderService` and `ProductPublishBuilderService` each know their own
 * destination kind statically. An MCP tool does not: the agent supplies an
 * arbitrary `connectionId` from `list_connections`, so the kind must be
 * discovered. This helper is that discovery, kept out of the tool files so the
 * two tools that need it cannot drift.
 *
 * NOT a cross-cutting concern in the `tool-registry.service.ts` sense — it
 * prepares one read's inputs rather than wrapping every call, so it belongs
 * with the tools rather than in the registry's per-call wrapper.
 *
 * @module apps/api/src/mcp/tools/read
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import { isTaxonomyBorrower, type TaxonomyOwner } from '@openlinker/core/listings';

export interface DestinationContext {
  /** Capability the destination's live category schema is read under. */
  readonly destinationCapability: 'OfferManager' | 'ProductPublisher';
  /** Owner taxonomy this destination borrows, when it borrows one (#1045). */
  readonly borrowedTaxonomy?: TaxonomyOwner;
}

/**
 * Resolve a destination's projection context, preferring the marketplace
 * capability and falling back to the shop one.
 *
 * A connection supports exactly one of the two, so the fallback is a kind
 * probe, not a retry loop. Resolution constructs the adapter but issues no
 * HTTP — the same cost `OfferBuilderService` already pays per build.
 *
 * Degrades to the marketplace default when NEITHER resolves: the downstream
 * service then fails with its own domain error, which is more actionable than
 * one invented here about capability discovery.
 */
export async function resolveDestinationContext(
  integrationsService: IIntegrationsService,
  destinationConnectionId: string
): Promise<DestinationContext> {
  const marketplace = await tryResolve(
    integrationsService,
    destinationConnectionId,
    'OfferManager'
  );
  if (marketplace !== null) {
    return {
      destinationCapability: 'OfferManager',
      // Read from the already-resolved adapter, mirroring OfferBuilderService.
      ...(isTaxonomyBorrower(marketplace)
        ? { borrowedTaxonomy: marketplace.getBorrowedTaxonomy() }
        : {}),
    };
  }

  const shop = await tryResolve(integrationsService, destinationConnectionId, 'ProductPublisher');
  if (shop !== null) {
    return { destinationCapability: 'ProductPublisher' };
  }

  return { destinationCapability: 'OfferManager' };
}

async function tryResolve(
  integrationsService: IIntegrationsService,
  connectionId: string,
  capability: 'OfferManager' | 'ProductPublisher'
): Promise<OfferManagerPort | null> {
  try {
    return await integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      capability
    );
  } catch {
    // A connection that does not support this capability is the expected
    // negative case of the probe, not a fault to surface.
    return null;
  }
}
