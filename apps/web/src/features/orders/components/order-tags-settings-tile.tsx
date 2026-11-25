/**
 * Order Tags Settings Tile
 *
 * The settings-index row that opens the order tags page.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { ORDER_TAG_LIMIT } from '../lib/order-tags';

export function OrderTagsSettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('orders').orderTagsSettingsTile;
  return (
    <SettingsIndexRow
      icon="tag"
      locked={locked}
      title={copy.title}
      description={interpolate(copy.description, { limit: ORDER_TAG_LIMIT })}
      action={{ label: copy.manageTags, to: '/settings/order-tags' }}
    />
  );
}
