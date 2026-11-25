/**
 * News and notifications settings page
 *
 * The admin switch for the update window, the notification bell and the guides. It used to sit at the
 * bottom of the sync pacing page only because that page already read the operational settings; it has
 * nothing to do with pacing, so it is a page of its own, reached from the Settings index.
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { describeApiError } from '../../shared/api/describe-api-error';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useSession } from '../../shared/auth/use-session';
import { useMessages } from '../../shared/i18n';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { ReleaseCenterSection } from '../../features/settings/components/release-center-section';
import { useOperationalSettingsQuery } from '../../features/settings/hooks/use-operational-settings-query';

export function ReleaseCenterSettingsPage(): ReactElement {
  const copy = useMessages('settings').releaseCenterPage;
  const { isReady } = useSession();
  const isAdmin = useIsAdmin();
  const query = useOperationalSettingsQuery();
  const back = { to: '/settings', label: copy.back };

  if (isReady && !isAdmin) {
    return (
      <PageLayout backTo={back} eyebrow={copy.eyebrow} title={copy.title}>
        <ErrorState title={copy.adminOnly.title} message={copy.adminOnly.message} />
      </PageLayout>
    );
  }

  return (
    <PageLayout backTo={back} eyebrow={copy.eyebrow} title={copy.title} description={copy.description}>
      {query.isPending ? (
        <LoadingState title={copy.loading.title} message={copy.loading.message} />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(query.error, 'settings')}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              {copy.error.retry}
            </Button>
          }
        />
      ) : query.data ? (
        <ReleaseCenterSection view={query.data} />
      ) : null}
    </PageLayout>
  );
}
