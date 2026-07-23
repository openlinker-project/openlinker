/**
 * useMappingPairing (#1784)
 *
 * Resolves the source -> destination connection pair for the order Mapping
 * Configuration page, mirroring the backend partner resolution in
 * `MappingOptionsController.resolvePartnerConnectionId`. The pairing is
 * config-stamped: a marketplace connection carries a single
 * `config.masterCatalogConnectionId` pointing at its master shop, so the pair
 * is determined rather than freely chosen.
 *
 * The pure `resolveMappingPairing` core is exported for unit testing without
 * React.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useConnectionQuery, useConnectionsQuery, type Connection } from '../../connections';
import { isSupportedSourcePlatform } from '../lib/supported-source-platforms';
import type { MappingPairing } from './use-mapping-pairing.types';

/** Read the single pairing key off a connection's `config`; empty/non-string -> undefined. */
function readMasterCatalogConnectionId(connection: Connection): string | undefined {
  const value = connection.config?.['masterCatalogConnectionId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolve the pairing from the URL connection plus the full connection list.
 * Never returns `loading`; the hook layers that on top of the queries.
 */
export function resolveMappingPairing(
  urlConnection: Connection,
  allConnections: Connection[],
): MappingPairing {
  const masterId = readMasterCatalogConnectionId(urlConnection);

  // A connection is the SOURCE side when it carries a pairing key (marketplace /
  // shop-listing connections stamp one) or is itself a supported marketplace
  // platform. Otherwise it is the master/destination shop.
  const urlIsSource = masterId !== undefined || isSupportedSourcePlatform(urlConnection.platformType);

  if (urlIsSource) {
    if (!isSupportedSourcePlatform(urlConnection.platformType)) {
      const destination = masterId
        ? allConnections.find((c) => c.id === masterId) ?? null
        : null;
      return { status: 'unsupported', source: urlConnection, destination };
    }
    if (!masterId) {
      return {
        status: 'error',
        error: new Error(
          'This connection is not linked to a product catalog. Set its catalog on the connection page to configure mappings.',
        ),
      };
    }
    const destination = allConnections.find((c) => c.id === masterId);
    if (!destination) {
      return {
        status: 'error',
        error: new Error(
          "The linked catalog connection could not be found. Check this connection's catalog pairing.",
        ),
      };
    }
    return { status: 'ready', source: urlConnection, destination };
  }

  // Master/destination shop: reverse-lookup the sources paired to it, narrowed
  // to supported marketplace platforms (mirrors the backend, plus the FE-only
  // allowlist). Disabled paired sources are INCLUDED (#1784 follow-up S11) so a
  // shop with only a disabled-but-paired marketplace is not misreported as
  // `no-source`; the page surfaces a non-active note instead, and the
  // pick-source picker labels the disabled candidates (they stay selectable).
  const supportedSources = allConnections.filter(
    (c) =>
      readMasterCatalogConnectionId(c) === urlConnection.id &&
      isSupportedSourcePlatform(c.platformType),
  );

  if (supportedSources.length === 0) {
    return { status: 'no-source', master: urlConnection };
  }
  if (supportedSources.length === 1) {
    return { status: 'ready', source: supportedSources[0], destination: urlConnection };
  }
  return { status: 'pick-source', master: urlConnection, candidates: supportedSources };
}

export function useMappingPairing(connectionId: string): MappingPairing {
  const urlConnectionQuery = useConnectionQuery(connectionId);
  const connectionsQuery = useConnectionsQuery();

  if (urlConnectionQuery.isLoading || connectionsQuery.isLoading) {
    return { status: 'loading' };
  }

  const queryError = urlConnectionQuery.error ?? connectionsQuery.error;
  if (queryError) {
    return { status: 'error', error: queryError };
  }

  if (!urlConnectionQuery.data || !connectionsQuery.data) {
    return { status: 'loading' };
  }

  return resolveMappingPairing(urlConnectionQuery.data, connectionsQuery.data);
}
