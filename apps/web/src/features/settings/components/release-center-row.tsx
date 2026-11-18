/**
 * Release Center Row
 *
 * Settings-index row for the release center switch. The switch itself lives on
 * the sync pacing page; this row only reports whether it is on, from the same
 * operational settings read the sync pacing row already makes.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useOperationalSettingsQuery } from '../hooks/use-operational-settings-query';

function ReleaseCenterLive(): ReactElement {
  const copy = useMessages('settings').releaseCenterRow;
  const query = useOperationalSettingsQuery();
  const enabled = query.data?.releaseCenterEnabled?.value;

  return (
    <SettingsIndexRow
      icon="sparkle"
      title={copy.title}
      description={copy.description}
      valueState={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
      value={enabled === undefined ? undefined : enabled ? copy.on : copy.off}
      tone={enabled ? 'success' : 'muted'}
      dot
      action={{ label: copy.open, to: '/settings/sync-pacing' }}
    />
  );
}

export function ReleaseCenterRow({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('settings').releaseCenterRow;
  return locked ? (
    <SettingsIndexRow locked icon="sparkle" title={copy.title} description={copy.description} />
  ) : (
    <ReleaseCenterLive />
  );
}
