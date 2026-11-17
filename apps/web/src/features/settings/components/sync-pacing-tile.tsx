/**
 * Sync Pacing Tile
 *
 * Settings-index row linking to the sync-pacing page. It shows the catalogue
 * value with the rung the API reported, so the row already answers "has anyone
 * touched this?" without a click.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useOperationalSettingsQuery } from '../hooks/use-operational-settings-query';

function SyncPacingLive(): ReactElement {
  const query = useOperationalSettingsQuery();
  const catalogue = query.data?.catalogueSweepBudget ?? null;
  const copy = useMessages('settings').syncPacingTile;
  const sourceLabel =
    catalogue === null
      ? ''
      : catalogue.source === 'setting'
        ? copy.sourceSetting
        : catalogue.source === 'env'
          ? copy.sourceEnv
          : copy.sourceDefault;

  return (
    <SettingsIndexRow
      title={copy.title}
      description={copy.description}
      valueState={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
      value={
        catalogue === null
          ? '-'
          : interpolate(copy.valueWithSource, { value: String(catalogue.value), source: sourceLabel })
      }
      note={copy.cataloguePerRun}
      action={{ label: copy.adjust, to: '/settings/sync-pacing' }}
    />
  );
}

export function SyncPacingTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('settings').syncPacingTile;
  return locked ? (
    <SettingsIndexRow locked title={copy.title} description={copy.description} />
  ) : (
    <SyncPacingLive />
  );
}
