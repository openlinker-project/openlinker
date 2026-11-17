/**
 * Sourcing Rules Tile
 *
 * The settings-index row that opens the sourcing rules page. Mounted only when
 * the OMS routing UI is enabled (#3634).
 *
 * @module apps/web/src/features/oms/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

export function SourcingRulesTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('oms-core').sourcingRulesTile;
  return (
    <SettingsIndexRow
      locked={locked}
      title={copy.title}
      description={copy.description}
      action={{ label: copy.linkLabel, to: '/settings/sourcing-rules' }}
    />
  );
}
