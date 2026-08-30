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
import { useOperationalSettingsQuery } from '../hooks/use-operational-settings-query';

export function SyncPacingTile(): ReactElement {
  const query = useOperationalSettingsQuery();
  const catalogue = query.data?.catalogueSweepBudget ?? null;

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Shop load</p>
          <h3 className="section-title">Sync pacing</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>
      <dl className="definition-list">
        <div>
          <dt>Products per catalogue run</dt>
          <dd className="mono-text">
            {query.isPending
              ? '…'
              : catalogue === null
                ? '—'
                : `${String(catalogue.value)} (${catalogue.source === 'setting' ? 'you set this' : catalogue.source === 'env' ? 'from a server setting' : 'default'})`}
          </dd>
        </div>
      </dl>
      <p className="muted-text">
        How hard OpenLinker works your shop, and how long a deleted product can keep selling.
      </p>
      <Link className="button button--secondary button--sm" to="/settings/sync-pacing">
        Adjust pacing
      </Link>
    </article>
  );
}
