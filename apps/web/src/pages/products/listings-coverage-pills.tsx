/**
 * Listings Coverage Pills
 *
 * Per-connection listings coverage for the products cockpit (#1720). Renders
 * one pill per ACTIVE OfferCreator connection - strictly connection-driven:
 * coverage rows for connections the operator no longer has (or that lack the
 * OfferCreator capability) are ignored, and a connection with no coverage row
 * renders as a 0/{variantCount} "none" pill. Visual states:
 * - full:    listed >= variantCount and variantCount > 0 (success)
 * - partial: 0 < listed < variantCount (warning)
 * - none:    listed = 0 or variantCount = 0 (muted)
 *
 * @module apps/web/src/pages/products
 */
import type { ReactElement } from 'react';
import type { Connection } from '../../features/connections';
import type { ProductListingsCoverage } from '../../features/products/api/products.types';
import { usePlatforms } from '../../shared/plugins';

export interface ListingsCoveragePillsProps {
  coverage: ProductListingsCoverage[] | undefined;
  variantCount: number;
  /** Active OfferCreator connections - the pill set is derived from these. */
  connections: readonly Connection[];
}

type CoverageState = 'full' | 'partial' | 'none';

function coverageState(listed: number, variantCount: number): CoverageState {
  if (variantCount > 0 && listed >= variantCount) return 'full';
  if (listed > 0 && listed < variantCount) return 'partial';
  return 'none';
}

export function ListingsCoveragePills({
  coverage,
  variantCount,
  connections,
}: ListingsCoveragePillsProps): ReactElement | null {
  const platforms = usePlatforms();

  if (connections.length === 0) return null;

  const listedByConnection = new Map<string, number>();
  for (const row of coverage ?? []) {
    listedByConnection.set(row.connectionId, row.listedVariants);
  }

  return (
    <span className="coverage-pills">
      {connections.map((connection) => {
        const listed = listedByConnection.get(connection.id) ?? 0;
        const state = coverageState(listed, variantCount);
        // Label by platform display name when it is the only connection of
        // that platform; fall back to the connection name to disambiguate
        // multiple shops/accounts on the same platform.
        const soleOfPlatform =
          connections.filter((c) => c.platformType === connection.platformType).length === 1;
        const label = soleOfPlatform
          ? (platforms.find((p) => p.platformType === connection.platformType)?.displayName ??
            connection.name)
          : connection.name;
        return (
          <span
            key={connection.id}
            className={`coverage-pill coverage-pill--${state}`}
            data-channel={connection.platformType}
            title={`${label}: ${listed} of ${variantCount} variant${variantCount === 1 ? '' : 's'} listed`}
          >
            {label}
            <span className="coverage-pill__count tabular">
              {listed}/{variantCount}
            </span>
          </span>
        );
      })}
    </span>
  );
}
