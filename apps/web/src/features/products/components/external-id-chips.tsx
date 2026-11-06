import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { ExternalIdMapping } from '../api/products.types';

interface ExternalIdChipsProps {
  mappings: ExternalIdMapping[];
}

export function ExternalIdChips({ mappings }: ExternalIdChipsProps): ReactElement {
  const copy = useMessages('products').externalIdChips;
  if (mappings.length === 0) {
    return <span className="text-muted">{copy.empty}</span>;
  }

  return (
    <div className="id-chip-row">
      {mappings.map((mapping) => (
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
  );
}
