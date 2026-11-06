/**
 * Login Page Settings Page
 *
 * `/settings/login-page` (#4029): the admin's editor for the copy a real
 * install's login page shows. Admin-only; the demo's copy is fixed and is
 * not edited here.
 *
 * @module pages/settings
 */
import type { ReactElement } from 'react';
import {
  LoginPageSettingsEditor,
  useLoginPageSettingsQuery,
} from '../../features/login-page-settings';
import { useSystemConfigQuery } from '../../features/system';
import { useActiveLocale, useMessages } from '../../shared/i18n';
import { AccessGate } from '../../shared/ui/access-gate';
import { Button } from '../../shared/ui/button';
import { AccessDeniedState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

function LoginPageSettingsContent(): ReactElement {
  const copy = useMessages('loginPageSettings');
  const locale = useActiveLocale();
  const query = useLoginPageSettingsQuery();
  const config = useSystemConfigQuery();

  if (query.isLoading || config.isLoading) {
    return <LoadingState liveRegion="off" title={copy.title} message={copy.saving} />;
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={copy.loadError}
        message={query.error?.message ?? copy.loadError}
        action={<Button onClick={() => void query.refetch()}>{copy.save}</Button>}
      />
    );
  }
  return (
    <LoginPageSettingsEditor
      view={query.data}
      registrationEnabled={config.data?.registrationEnabled ?? false}
      initialLocale={locale === 'pl' ? 'pl' : 'en'}
    />
  );
}

export function LoginPageSettingsPage(): ReactElement {
  const copy = useMessages('loginPageSettings');
  return (
    <PageLayout
      backTo={{ to: '/settings', label: copy.back }}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <AccessGate require="users:write" fallback={<AccessDeniedState />}>
        <LoginPageSettingsContent />
      </AccessGate>
    </PageLayout>
  );
}
