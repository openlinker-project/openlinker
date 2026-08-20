/**
 * Erli borrowed-Allegro-taxonomy policy
 *
 * Two questions about the Allegro taxonomy an Erli connection borrows
 * (ADR-025 §3 / ADR-031 / #2210), answered in ONE place because the answers are
 * read from two different call sites that must never disagree:
 *
 * - `ErliAdapterFactory.buildAllegroCategoryCatalog` builds the client that
 *   actually reads Allegro's catalogue for this connection.
 * - `ErliOfferManagerAdapter.getBorrowedTaxonomy` declares which taxonomy owner
 *   this connection consumes, which core matches against what an Allegro
 *   connection reports from `getTaxonomyIdentity` (`'allegro'` vs
 *   `'allegro:sandbox'`, #2063).
 *
 * When those two disagree the borrow silently resolves nothing - no candidate
 * owner matches the declared value - and the projection scope the connection
 * reads under names an environment it does not actually read from. Both were
 * derived independently before this file existed, and they differed for the
 * ordinary `{ environment: 'sandbox', allegroEnvironment: undefined }` setup.
 *
 * @module libs/integrations/erli/src/domain/policies
 */
import type {
  AllegroCatalogEnvironment,
  ErliConnectionConfig,
} from '../types/erli-connection.types';

/**
 * Which Allegro environment this connection's borrowed taxonomy comes from.
 *
 * `config.environment` is deliberately NOT consulted: it selects the ERLI Shop
 * API host, a different axis that only type-checks alongside this one because
 * both happen to be `'sandbox' | 'production'`. An Erli sandbox connection
 * borrowing the real Allegro catalogue is the ordinary test topology, so
 * inferring the taxonomy environment from the shop environment would declare a
 * sandbox owner for a production catalogue.
 */
export function resolveErliAllegroTaxonomyEnvironment(
  config: ErliConnectionConfig
): AllegroCatalogEnvironment {
  return config.allegroEnvironment ?? 'production';
}

/**
 * Whether this connection may reach Allegro's catalogue at all.
 *
 * An explicit `false` is the operator-facing "Allegro category access" opt-out
 * (#1934/F10). It disarms both mechanisms that reach that catalogue: this
 * connection's own category browsing (the `AllegroCategoryCatalogClient`) and
 * the borrowed EAN lookup core performs through a peer Allegro connection
 * (#2210). The second is a different mechanism - it spends the PEER's
 * credentials and rate-limit budget - but it is the same effect the operator
 * switched off, so the toggle has to cover it.
 *
 * Absent (not `false`) keeps the pre-toggle behaviour, so connections predating
 * it - or created through the API - are not silently downgraded.
 */
export function erliAllowsAllegroCatalogueAccess(config: ErliConnectionConfig): boolean {
  return config.allegroCategoryAccessEnabled !== false;
}
