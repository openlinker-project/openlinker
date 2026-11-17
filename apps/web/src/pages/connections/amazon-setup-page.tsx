/**
 * Amazon Setup Page
 *
 * Page wrapper for the guided Amazon connection form (#4186). Creating a
 * connection needs `connections:write`; a read-only session is told so
 * instead of seeing a form whose submit would be refused.
 */
import type { ReactElement } from 'react';
import { AmazonSetupForm } from '../../features/amazon';
import { useMessages } from '../../shared/i18n';
import { AccessGate } from '../../shared/ui/access-gate';
import { Alert } from '../../shared/ui/alert';
import { PageLayout } from '../../shared/ui/page-layout';

export function AmazonSetupPage(): ReactElement {
  const copy = useMessages('amazon').setup;
  return (
    <PageLayout eyebrow="Amazon" title={copy.title} description={copy.description}>
      <AccessGate
        require="connections:write"
        fallback={
          <Alert tone="info" title={copy.readOnlyTitle}>
            {copy.readOnly}
          </Alert>
        }
      >
        <AmazonSetupForm />
      </AccessGate>
    </PageLayout>
  );
}
