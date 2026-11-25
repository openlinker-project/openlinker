/**
 * Buyer Data Settings Tile (#4289)
 *
 * The settings-index row that opens `/settings/buyer-data`, like `BuyerEmailsTile`.
 * Admin only: the rules are an operational setting, so a non-admin sees the row
 * locked rather than missing.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

export function BuyerDataTile({ locked = false }: { locked?: boolean }): ReactElement {
  const COPY = useMessages('buyer-data').tile;
  return (
    <SettingsIndexRow
      icon="users"
      locked={locked}
      title={COPY.title}
      description={COPY.description}
      action={{ label: COPY.link, to: '/settings/buyer-data' }}
    />
  );
}
