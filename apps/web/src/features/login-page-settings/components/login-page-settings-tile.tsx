/**
 * Login Page Settings Tile
 *
 * The settings-index row that opens the login page settings.
 *
 * @module apps/web/src/features/login-page-settings/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';

export function LoginPageSettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('login-page-settings');
  return (
    <SettingsIndexRow
      locked={locked}
      title={copy.title}
      description={copy.tile}
      action={{ label: copy.title, to: '/settings/login-page' }}
    />
  );
}
