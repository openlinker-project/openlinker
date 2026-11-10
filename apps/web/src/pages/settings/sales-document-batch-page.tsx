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
import { interpolate, useMessages } from '../../shared/i18n';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { useConnectionQuery } from '../../features/connections';
import { SalesDocumentBatchScreen } from '../../features/sales-documents';

export function SalesDocumentBatchPage(): ReactElement {
  const copy = useMessages('sales-documents').batch.page;
  const { session } = useSession();
  const isAdmin = useIsAdmin();
  const { connectionId = '' } = useParams<{ connectionId: string }>();
  const connection = useConnectionQuery(connectionId);

  if (session.status === 'authenticated' && !isAdmin) {
    return (
      <PageLayout
        eyebrow={copy.eyebrowShort}
        title={copy.title}
        description={copy.adminDescription}
      >
        <ErrorState
          title={copy.adminTitle}
          message={`${copy.adminReason} ${copy.adminRequirement}`}
        />
      </PageLayout>
    );
  }

  const name = connection.data?.name;
  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={name ? interpolate(copy.titleFor, { name }) : copy.title}
      description={copy.description}
      backTo={{ to: '/settings/sales-documents', label: copy.backLabel }}
    >
      <SalesDocumentBatchScreen connectionId={connectionId} />
    </PageLayout>
  );
}
