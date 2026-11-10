/**
 * CategoryMappingContextBar
 *
 * Says, in one line, which pair the page is editing: categories from this
 * catalogue, for that marketplace. A mapping belongs to that pair (#3993), so
 * the marketplace is picked inside the sentence itself rather than in a
 * detached form field, and the progress beside it is for that pair only.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import { interpolate, useMessages } from '../../../shared/i18n';
import type { Connection } from '../../connections';

interface CategoryMappingContextBarProps {
  catalogue: Connection;
  cataloguePlatform: string;
  marketplaces: readonly Connection[];
  marketplaceConnectionId: string;
  onMarketplaceChange: (connectionId: string) => void;
  mapped: number;
  total: number;
}

const MARKETPLACE_SELECT_ID = 'marketplace-connection-select';

export function CategoryMappingContextBar({
  catalogue,
  cataloguePlatform,
  marketplaces,
  marketplaceConnectionId,
  onMarketplaceChange,
  mapped,
  total,
}: CategoryMappingContextBarProps): ReactElement {
  const copy = useMessages('mappings').categoryMappings;
  const hasMarketplace = marketplaces.some((c) => c.id === marketplaceConnectionId);
  const percent = total === 0 ? 0 : Math.round((mapped / total) * 100);
  const progressText = interpolate(copy.progressLabel, { mapped, total });

  return (
    <div className="category-map-context" role="group" aria-label={copy.pairLabel}>
      <p className="category-map-context__pair">
        <span className="category-map-context__word">{copy.contextFrom}</span>
        <span className="category-map-context__catalogue">
          <span className="category-map-context__catalogue-name">{catalogue.name}</span>
          <span className="category-map-context__platform">{cataloguePlatform}</span>
        </span>
        <label className="category-map-context__word" htmlFor={MARKETPLACE_SELECT_ID}>
          {copy.contextFor}
        </label>
        <Select
          id={MARKETPLACE_SELECT_ID}
          className="category-map-context__select"
          aria-label={copy.mapForLabel}
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
      </p>

      {hasMarketplace ? (
        <div className="category-map-context__progress" data-testid="category-mappings-progress">
          <span className="category-map-context__progress-text">{progressText}</span>
          <span
            className="category-map-context__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={mapped}
            aria-valuetext={progressText}
          >
            <span className="category-map-context__fill" style={{ width: `${percent}%` }} />
          </span>
        </div>
      ) : null}
    </div>
  );
}
