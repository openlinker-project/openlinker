/**
 * Who-Decides Tile
 *
 * The `SettingsPage` entry point for `/settings/who-decides`.
 *
 * **Deliberately NOT admin-gated, unlike every other settings tile.** All five
 * neighbours render as `{isAdmin ? <XTile /> : null}`, but #2353 authorises
 * `GET /fulfillment-authority/status` for a read-only role *specifically* so
 * that role can see who decides what. Gating the tile would make that read
 * unreachable for exactly the role it was widened for. The write control inside
 * the page is what `useWriteAccess` gates. `settings-page.test.tsx` pins this
 * beside the opposite expectation for the Mailer tile.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { WHO_DECIDES_TILE_COPY } from '../lib/who-decides.copy';

export function WhoDecidesTile(): ReactElement {
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{WHO_DECIDES_TILE_COPY.eyebrow}</p>
          <h3 className="section-title">{WHO_DECIDES_TILE_COPY.title}</h3>
        </div>
      </div>
      <p className="muted-text">{WHO_DECIDES_TILE_COPY.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/who-decides">
        {WHO_DECIDES_TILE_COPY.linkLabel}
      </Link>
    </article>
  );
}
