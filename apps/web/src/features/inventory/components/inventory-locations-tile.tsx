/**
 * Inventory Locations Tile
 *
 * The settings-index row that opens the inventory locations page. Mounted only
 * when the OMS routing UI is enabled (#3634).
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

export function InventoryLocationsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('inventory').inventoryLocationsTile;
  return (
    <SettingsIndexRow
      icon="pin"
      locked={locked}
      title={copy.title}
      description={copy.description}
      action={{ label: copy.linkLabel, to: '/inventory/locations' }}
    />
  );
}
