/**
 * CategoryMappingPairStrip
 *
 * States which pair the Category Mappings page is editing: the catalogue the
 * categories come from, and the marketplace they are mapped for. A mapping
 * belongs to that pair (#3993), so the marketplace is chosen here, in the same
 * source -> destination strip the order Mappings page uses (#1784), rather
 * than in a detached form field.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { Connection } from '../../connections';

interface CategoryMappingPairStripProps {
  catalogue: Connection;
  cataloguePlatform: string;
  marketplaces: readonly Connection[];
  marketplaceConnectionId: string;
  onMarketplaceChange: (connectionId: string) => void;
}

const MARKETPLACE_SELECT_ID = 'marketplace-connection-select';

function initials(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function CategoryMappingPairStrip({
  catalogue,
  cataloguePlatform,
  marketplaces,
  marketplaceConnectionId,
  onMarketplaceChange,
}: CategoryMappingPairStripProps): ReactElement {
  const copy = useMessages('mappings').categoryMappings;
  const marketplace = marketplaces.find((c) => c.id === marketplaceConnectionId);

  return (
    <div className="mapping-pair category-mapping-pair" role="group" aria-label={copy.pairLabel}>
      <div className="mapping-pair__row">
        <div className="mapping-pair__node">
          <span className="mapping-pair__role">{copy.catalogueRole}</span>
          <span className="mapping-pair__chip">
            <span className="mapping-pair__glyph" aria-hidden="true">
              {initials(cataloguePlatform)}
            </span>
            <span className="mapping-pair__chip-text">
              <span className="mapping-pair__name">{catalogue.name}</span>
              <span className="mapping-pair__platform">{cataloguePlatform}</span>
            </span>
          </span>
        </div>

        <div className="mapping-pair__connector" aria-hidden="true">
          <span className="mapping-pair__arrow">→</span>
        </div>

        <div className="mapping-pair__node mapping-pair__node--dest">
          <label className="mapping-pair__role" htmlFor={MARKETPLACE_SELECT_ID}>
            {copy.mapForLabel}
          </label>
          <Select
            id={MARKETPLACE_SELECT_ID}
            data-testid="category-mappings-marketplace-select"
            value={marketplaceConnectionId}
            onChange={(e) => { onMarketplaceChange(e.target.value); }}
          >
            <option value="" disabled>
              {copy.mapForPlaceholder}
            </option>
            {marketplaces.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {marketplace ? (
            <p className="mapping-pair__meta" data-testid="category-mappings-scope-hint">
              {interpolate(copy.scopeHint, { marketplace: marketplace.name })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
