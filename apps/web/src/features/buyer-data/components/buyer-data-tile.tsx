/**
 * Buyer Data Settings Tile (#4289)
 *
 * The `SettingsPage` entry point for `/settings/buyer-data`, a link-out card
 * like `BuyerEmailsTile`. Admin only: the rules are an operational setting.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';

export function BuyerDataTile(): ReactElement {
  const COPY = useMessages('buyer-data').tile;
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{COPY.eyebrow}</p>
          <h3 className="section-title">{COPY.title}</h3>
        </div>
      </div>
      <p className="muted-text">{COPY.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/buyer-data">
        {COPY.link}
      </Link>
    </article>
  );
}
