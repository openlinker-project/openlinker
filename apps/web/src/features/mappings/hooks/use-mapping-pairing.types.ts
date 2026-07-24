/**
 * Mapping pairing types (#1784)
 *
 * The resolved source -> destination pairing for the order Mapping
 * Configuration page. Mirrors the backend partner resolution
 * (`MappingOptionsController.resolvePartnerConnectionId`): a marketplace
 * connection carries `config.masterCatalogConnectionId` pointing at exactly
 * one master shop, so the pair is determined, not freely chosen.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import type { Connection } from '../../connections';

export type MappingPairing =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  /** Source platform is not in the FE supported-pairs allowlist. */
  | { status: 'unsupported'; source: Connection; destination: Connection | null }
  /** Opened from a master shop that has no paired source connection. */
  | { status: 'no-source'; master: Connection }
  /** Opened from a master shop with several paired sources - operator must pick. */
  | { status: 'pick-source'; master: Connection; candidates: Connection[] }
  /** Resolved, unambiguous, supported pair. `source` owns the mapping data. */
  | { status: 'ready'; source: Connection; destination: Connection };
