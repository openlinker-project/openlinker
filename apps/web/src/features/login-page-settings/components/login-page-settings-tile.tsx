/**
 * Login Page Settings Tile
 *
 * The settings-index row that opens the login page settings. Its value says
 * whether anyone has changed the login page text or the request-for-access
 * switch, read from the rung each field already reports.
 *
 * @module apps/web/src/features/login-page-settings/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useLoginPageSettingsQuery } from '../hooks/use-login-page-settings-query';
import type { LoginPageSettingsView } from '../api/login-page-settings.types';

function isCustomised(view: LoginPageSettingsView): boolean {
  if (view.registration.source === 'setting') return true;
  return Object.values(view.copy).some((locale) =>
    Object.values(locale).some((field) => field.source === 'setting'),
  );
}

function LoginPageLive(): ReactElement {
  const copy = useMessages('login-page-settings');
  const query = useLoginPageSettingsQuery();
  const customised = query.data ? isCustomised(query.data) : false;

  return (
    <SettingsIndexRow
      icon="window"
      title={copy.title}
      description={copy.tile}
      valueState={query.isLoading ? 'loading' : query.isError ? 'error' : 'ready'}
      value={query.data ? (customised ? copy.tileCustomised : copy.tileDefault) : undefined}
      tone={customised ? 'info' : 'muted'}
      action={{ label: copy.title, to: '/settings/login-page' }}
    />
  );
}

export function LoginPageSettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('login-page-settings');
  return locked ? (
    <SettingsIndexRow locked icon="window" title={copy.title} description={copy.tile} />
  ) : (
    <LoginPageLive />
  );
}
