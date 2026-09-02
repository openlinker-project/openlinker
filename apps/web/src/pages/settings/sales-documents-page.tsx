/**
 * Sales Documents Page (#2159)
 *
 * Admin-only page hosting the centralized "Settings → Sales documents" view
 * — see `SalesDocumentRuleEnginePanel` for the content itself. Mirrors
 * `McpTokensPage`'s admin-gating shape.
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { SalesDocumentRuleEnginePanel } from '../../features/sales-documents';

export function SalesDocumentsPage(): ReactElement {
  const { session } = useSession();

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow="Settings" title="Sales documents" description="Admin-only access.">
        <ErrorState
          title="Admin role required"
          message="This page routes fiscal documents to a connection — it requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Settings"
      title="Sales documents"
      description="Choose what each market issues, per country. OpenLinker never decides which document an order legally needs."
      backTo={{ to: '/settings', label: 'Settings' }}
    >
      <SalesDocumentRuleEnginePanel />
    </PageLayout>
  );
}
