import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ExternalIdMapping } from '../api/products.types';

interface ExternalIdChipsProps {
  mappings: ExternalIdMapping[];
}

export function ExternalIdChips({ mappings }: ExternalIdChipsProps): ReactElement {
  if (mappings.length === 0) {
    return <span className="text-muted">No external mappings</span>;
  }

  return (
    <div className="id-chip-row">
      {mappings.map((mapping) => (
        <Link
          key={`${mapping.platformType}-${mapping.connectionId}-${mapping.externalId}`}
          className="id-chip id-chip--link"
          to={`/connections/${mapping.connectionId}`}
          title={`Open connection for ${mapping.platformType} ${mapping.externalId}`}
        >
          <span className="id-chip__platform">{mapping.platformType}</span>
          <span>{mapping.externalId}</span>
        </Link>
      ))}
    </div>
  );
}
