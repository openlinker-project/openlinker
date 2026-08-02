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
import { Logger } from '@openlinker/shared/logging';

const logger = new Logger('McpDestinationContext');

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
  // Typed resolve ONLY here, where the adapter is actually consumed
  // (`isTaxonomyBorrower` narrows it). The shop branch below asks a
  // presence question and must not claim a port type it never uses.
  const marketplace = await resolveOfferManager(integrationsService, destinationConnectionId);
  if (marketplace !== null) {
    return {
      destinationCapability: 'OfferManager',
      // Read from the already-resolved adapter, mirroring OfferBuilderService.
      ...(isTaxonomyBorrower(marketplace)
        ? { borrowedTaxonomy: marketplace.getBorrowedTaxonomy() }
        : {}),
    };
  }

  if (await supportsCapability(integrationsService, destinationConnectionId, 'ProductPublisher')) {
    return { destinationCapability: 'ProductPublisher' };
  }

  return { destinationCapability: 'OfferManager' };
}

async function resolveOfferManager(
  integrationsService: IIntegrationsService,
  connectionId: string
): Promise<OfferManagerPort | null> {
  try {
    return await integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );
  } catch (error) {
    logProbeMiss(connectionId, 'OfferManager', error);
    return null;
  }
}

/**
 * Presence probe. Deliberately returns a boolean rather than the adapter:
 * `getCapabilityAdapter<T>` is unconstrained, so typing this as a port would
 * ASSERT rather than check — and a shop resolves a `ShopProductManagerPort`,
 * not an `OfferManagerPort`. Returning the wrong port type would compile and
 * only fail at runtime once someone called a method on it.
 */
async function supportsCapability(
  integrationsService: IIntegrationsService,
  connectionId: string,
  capability: string
): Promise<boolean> {
  try {
    await integrationsService.getCapabilityAdapter<unknown>(connectionId, capability);
    return true;
  } catch (error) {
    logProbeMiss(connectionId, capability, error);
    return false;
  }
}

/**
 * A miss is usually the expected negative half of the probe — but it is also
 * how a REAL fault (unresolvable credentials, adapter-factory throw, unknown
 * connection) presents. Logging keeps the two distinguishable: without it, a
 * broken connection silently degrades to the marketplace default and the
 * operator sees only a confusing downstream error. Mirrors
 * `CategoryResolutionService.tryAutoDetect`, which likewise degrades AND logs.
 */
function logProbeMiss(connectionId: string, capability: string, error: unknown): void {
  logger.debug(
    `Destination ${connectionId} did not resolve under "${capability}": ${
      (error as Error).message
    }`
  );
}
