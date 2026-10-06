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

export function OrderTagsSettingsTile(): ReactElement {
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Orders</p>
          <h3 className="section-title">Order tags</h3>
        </div>
      </div>
      <p className="muted-text">
        Colour, rename and delete the workspace's order tags. Up to 50, created from the tag
        picker on any order.
      </p>
      <Link className="button button--secondary button--sm" to="/settings/order-tags">
        Manage tags
      </Link>
    </article>
  );
}
