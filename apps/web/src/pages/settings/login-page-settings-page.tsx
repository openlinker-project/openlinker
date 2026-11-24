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
import { describeApiError } from '../../shared/api/describe-api-error';
import {
  LoginPageSettingsEditor,
  useLoginPageSettingsQuery,
} from '../../features/login-page-settings';
import { useActiveLocale, useMessages } from '../../shared/i18n';
import { AccessGate } from '../../shared/ui/access-gate';
import { Button } from '../../shared/ui/button';
import { AccessDeniedState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

function LoginPageSettingsContent(): ReactElement {
  const copy = useMessages('login-page-settings');
  const locale = useActiveLocale();
  const query = useLoginPageSettingsQuery();

  if (query.isLoading) {
    return <LoadingState liveRegion="off" title={copy.title} message={copy.saving} />;
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={copy.loadError}
        message={query.error ? describeApiError(query.error, 'login-page-settings') : copy.loadError}
        action={<Button onClick={() => void query.refetch()}>{copy.save}</Button>}
      />
    );
  }
  return (
    <LoginPageSettingsEditor view={query.data} initialLocale={locale === 'pl' ? 'pl' : 'en'} />
  );
}

export function LoginPageSettingsPage(): ReactElement {
  const copy = useMessages('login-page-settings');
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
