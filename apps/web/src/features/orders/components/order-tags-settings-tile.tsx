/**
 * Order Tags Settings Tile (#3532/#3533, D34)
 *
 * The `SettingsPage` entry point for `/settings/order-tags` — a link-out
 * card, mirroring `InventoryLocationsTile` / `WhoDecidesTile`. Admin only,
 * matching the page it links to (the manager's writes are `@Roles('admin')`
 * — see `OrderTagsController`); a new tag is created from the picker
 * elsewhere, not here, so an operator without admin loses nothing by not
 * seeing this tile.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { ORDER_TAG_LIMIT } from '../lib/order-tags';

export function OrderTagsSettingsTile(): ReactElement {
  const copy = useMessages('orders').orderTagsSettingsTile;
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
      </div>
      <p className="muted-text">{interpolate(copy.description, { limit: ORDER_TAG_LIMIT })}</p>
      <Link className="button button--secondary button--sm" to="/settings/order-tags">
        {copy.manageTags}
      </Link>
    </article>
  );
}
