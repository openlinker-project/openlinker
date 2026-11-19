/**
 * Release Center Row
 *
 * Settings-index row for the news and notifications switch. It opens the page of its own
 * and reports whether the switch is on, from the same operational settings read.
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
      action={{ label: copy.open, to: '/settings/release-center' }}
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
