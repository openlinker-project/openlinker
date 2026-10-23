/**
 * Inventory Locations Tile
 *
 * The `SettingsPage` entry point for `/inventory/locations` (#2316 /
 * #3066) — a link-out card, not an inline configuration form, mirroring
 * `WhoDecidesTile`'s shape rather than the admin-only settings forms
 * (Currency, Mailer, MCP tokens, …).
 *
 * **Deliberately NOT admin-gated** — `InventoryLocationsController`'s reads
 * are `@Roles('admin', 'operator', 'viewer')` and the sidebar nav entry is
 * already gated on `inventory:read`, not on being an admin. Gating this tile
 * to admin-only would make it LESS reachable than the nav item that already
 * links to the same page, for no reason tied to what the page actually
 * requires.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { INVENTORY_LOCATIONS_TILE_COPY } from '../lib/inventory-locations-tile.copy';

export function InventoryLocationsTile(): ReactElement {
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{INVENTORY_LOCATIONS_TILE_COPY.eyebrow}</p>
          <h3 className="section-title">{INVENTORY_LOCATIONS_TILE_COPY.title}</h3>
        </div>
      </div>
      <p className="muted-text">{INVENTORY_LOCATIONS_TILE_COPY.description}</p>
      <Link className="button button--secondary button--sm" to="/inventory/locations">
        {INVENTORY_LOCATIONS_TILE_COPY.linkLabel}
      </Link>
    </article>
  );
}
