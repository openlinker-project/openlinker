/**
 * Buyer Emails Tile
 *
 * The settings-index row that opens the buyer emails page.
 *
 * @module apps/web/src/features/buyer-emails/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

export function BuyerEmailsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('buyer-emails').tile;
  return (
    <SettingsIndexRow
      icon="mail"
      locked={locked}
      title={copy.title}
      description={copy.description}
      action={{ label: copy.link, to: '/settings/buyer-emails' }}
    />
  );
}
