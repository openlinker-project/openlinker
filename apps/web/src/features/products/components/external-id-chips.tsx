import type { ReactElement } from 'react';
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
        <span key={`${mapping.platformType}-${mapping.connectionId}-${mapping.externalId}`} className="id-chip">
          <span className="id-chip__platform">{mapping.platformType}</span>
          <span>{mapping.externalId}</span>
        </span>
      ))}
    </div>
  );
}
