/**
 * Pack orders in OpenLinker (#3457)
 *
 * The page behind `/settings/packing`. It owns two things only: the
 * connections read, and resolving the OMS connection by platform — the one
 * platform comparison the wizard needs, kept at the page layer (#3060
 * precedent). Everything else is `OmsOnboarding`.
 *
 * With more than one OMS connection (nothing on the server prevents it), the
 * oldest is used: it is the one an earlier setup most likely created, and
 * creating a third would only make the ambiguity worse.
 *
 * @module pages/oms
 */
import type { ReactElement } from 'react';

import { useConnectionsQuery } from '../../features/connections';
import { OmsOnboarding, omsOnboardingCopy as COPY } from '../../features/oms-onboarding';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { findOmsConnections, OMS_PLATFORM_TYPE } from './oms-connection';

export function OmsOnboardingPage(): ReactElement {
  const connectionsQuery = useConnectionsQuery();

  if (connectionsQuery.isLoading || connectionsQuery.error) {
    return (
      <PageLayout
        eyebrow={COPY.page.eyebrow}
        title={COPY.page.wizardTitle}
        description={COPY.page.wizardDescription}
        backTo={{ to: '/connections/new', label: COPY.page.backToConnections }}
      >
        {connectionsQuery.isLoading ? (
          <LoadingState title={COPY.page.loadingTitle} message={COPY.page.loadingMessage} />
        ) : (
          <ErrorState
            title={COPY.page.errorTitle}
            message={COPY.page.errorMessage}
            action={
              <Button tone="secondary" onClick={() => void connectionsQuery.refetch()}>
                {COPY.page.retry}
              </Button>
            }
          />
        )}
      </PageLayout>
    );
  }

  const connections = connectionsQuery.data ?? [];
  const packingConnection =
    [...findOmsConnections(connections)].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;

  return (
    <OmsOnboarding
      connections={connections}
      packingConnection={packingConnection}
      omsPlatformType={OMS_PLATFORM_TYPE}
    />
  );
}
