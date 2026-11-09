/**
 * Sync Pacing Tile
 *
 * Admin-only settings tile linking to the sync-pacing page. Mirrors
 * `SalesDocumentsTile` / `McpTokensTile`.
 *
 * It shows the catalogue value with the rung the API reported, so the tile
 * itself already answers "has anyone touched this?" without a click.
 *
 * @module apps/web/src/features/settings/components
 */
import { Link } from 'react-router-dom';
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { useOperationalSettingsQuery } from '../hooks/use-operational-settings-query';

export function SyncPacingTile(): ReactElement {
  const query = useOperationalSettingsQuery();
  const catalogue = query.data?.catalogueSweepBudget ?? null;
  const copy = useMessages('settings').syncPacingTile;
  const sourceLabel =
    catalogue === null
      ? ''
      : catalogue.source === 'setting'
        ? copy.sourceSetting
        : catalogue.source === 'env'
          ? copy.sourceEnv
          : copy.sourceDefault;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <span className="panel__meta">{copy.adminOnly}</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>{copy.cataloguePerRun}</dt>
          <dd className="mono-text">
            {query.isPending
              ? '…'
              : catalogue === null
                ? '—'
                : interpolate(copy.valueWithSource, { value: String(catalogue.value), source: sourceLabel })}
          </dd>
        </div>
      </dl>
      <p className="muted-text">
        {copy.description}
      </p>
      <Link className="button button--secondary button--sm" to="/settings/sync-pacing">
        {copy.adjust}
      </Link>
    </article>
  );
}
