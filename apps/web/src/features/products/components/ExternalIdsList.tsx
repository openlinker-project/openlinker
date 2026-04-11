import type { ReactElement } from 'react';
import type { ExternalIdMapping } from '../api/products.types';

interface ExternalIdsListProps {
  mappings: ExternalIdMapping[];
}

export function ExternalIdsList({ mappings }: ExternalIdsListProps): ReactElement {
  if (mappings.length === 0) {
    return <span className="text-muted">No external mappings</span>;
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {mappings.map((m) => (
        <li key={`${m.platformType}-${m.connectionId}-${m.externalId}`} className="mono-text">
          {m.platformType} — {m.externalId}
        </li>
      ))}
    </ul>
  );
}
