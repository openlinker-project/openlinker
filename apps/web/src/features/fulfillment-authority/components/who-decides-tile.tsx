/**
 * Who-Decides Tile
 *
 * The `SettingsPage` entry point for `/settings/who-decides`.
 *
 * **Deliberately NOT admin-gated, unlike every other settings row.** All the
 * others are locked for a non-admin, but #2353 authorises
 * `GET /fulfillment-authority/status` for a read-only role *specifically* so
 * that role can see who decides what. Locking the row would make that read
 * unreachable for exactly the role it was widened for. The write control inside
 * the page is what `useWriteAccess` gates. `settings-page.test.tsx` pins this
 * beside the opposite expectation for the Mailer row.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import type { ReactElement } from 'react';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { WHO_DECIDES_TILE_COPY } from '../lib/who-decides-text';

export function WhoDecidesTile(): ReactElement {
  return (
    <SettingsIndexRow
      icon="users"
      title={WHO_DECIDES_TILE_COPY.title}
      description={WHO_DECIDES_TILE_COPY.description}
      action={{ label: WHO_DECIDES_TILE_COPY.linkLabel, to: '/settings/who-decides' }}
    />
  );
}
