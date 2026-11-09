/**
 * Product Source Section (#1752)
 *
 * Renames the product-detail "External IDs" block to "Source" and leads with
 * the product's master origin — `externalIds[0]`, the mapping the cockpit's
 * Source column already treats as provenance — shown as a channel pill +
 * connection name + `platformType · externalId` with a `Master` tag. Any
 * further per-connection identifier mappings list beneath as secondary chips.
 *
 * @module apps/web/src/features/products/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { usePlatforms } from '../../../shared/plugins';
import { resolvePlatformLabel } from '../../mappings';
import type { Connection } from '../../connections';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { ExternalIdMapping } from '../api/products.types';

interface ProductSourceSectionProps {
  mappings: ExternalIdMapping[];
  connections: readonly Connection[];
}

export function ProductSourceSection({
  mappings,
  connections,
}: ProductSourceSectionProps): ReactElement {
  const platforms = usePlatforms();
  const copy = useMessages('products').productSourceSection;

  if (mappings.length === 0) {
    return <span className="text-muted">{copy.empty}</span>;
  }

  const [primary, ...rest] = mappings;
  const platformLabel = resolvePlatformLabel(platforms, primary);
  const connectionName = connections.find((c) => c.id === primary.connectionId)?.name;

  return (
    <div className="product-source">
      <Link
        className="product-source__primary"
        to={`/connections/${primary.connectionId}`}
        title={interpolate(copy.openMasterConnection, { platform: platformLabel })}
      >
        <span className="channel-pill" data-channel={primary.platformType}>
          {platformLabel}
        </span>
        <span className="product-source__body">
          <span className="product-source__conn">{connectionName ?? platformLabel}</span>
          <span className="product-source__ref">
            {primary.platformType} · {primary.externalId}
          </span>
        </span>
        <StatusBadge className="product-source__tag" tone="neutral" compact>
          {copy.masterTag}
        </StatusBadge>
      </Link>

      {rest.length > 0 ? (
        <div className="product-source__more">
          <span className="product-source__more-label">{copy.alsoMappedOn}</span>
          <div className="id-chip-row">
            {rest.map((mapping) => (
              <Link
                key={`${mapping.platformType}-${mapping.connectionId}-${mapping.externalId}`}
                className="id-chip id-chip--link"
                to={`/connections/${mapping.connectionId}`}
                title={interpolate(copy.openConnection, {
                  platform: mapping.platformType,
                  externalId: mapping.externalId,
                })}
              >
                <span className="id-chip__platform">{mapping.platformType}</span>
                <span>{mapping.externalId}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
