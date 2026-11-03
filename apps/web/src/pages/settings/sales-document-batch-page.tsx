/**
 * Sales Document Batch Page (#3584, mockup M15)
 *
 * Settings › Sales documents › Batch issuing for one connection. Reached from
 * the "Configure" link on a "Connected providers" row whose "When it issues"
 * is Batch. Admin-only, like the routing page it hangs off.
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useConnectionQuery } from '../../features/connections';
import { SalesDocumentBatchScreen } from '../../features/sales-documents';

export function SalesDocumentBatchPage(): ReactElement {
  const { session } = useSession();
  const isAdmin = useIsAdmin();
  const { connectionId = '' } = useParams<{ connectionId: string }>();
  const connection = useConnectionQuery(connectionId);

  if (session.status === 'authenticated' && !isAdmin) {
    return (
      <PageLayout eyebrow="Settings" title="Batch issuing" description="Admin-only access.">
        <ErrorState
          title="Admin role required"
          message="Batch issuing creates fiscal documents on a schedule. It requires an admin session."
        />
      </PageLayout>
    );
  }

  const name = connection.data?.name;
  return (
    <PageLayout
      eyebrow="Settings · Sales documents"
      title={name ? `Batch issuing: ${name}` : 'Batch issuing'}
      description="Groups this connection's invoices and receipts into scheduled runs instead of issuing each one the moment its order qualifies."
      backTo={{ to: '/settings/sales-documents', label: 'Sales documents routing' }}
    >
      <SalesDocumentBatchScreen connectionId={connectionId} />
    </PageLayout>
  );
}
