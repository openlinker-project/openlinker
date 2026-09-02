/**
 * Sales Documents Page (#2159)
 *
 * Admin-only page hosting the centralized "Settings → Sales documents" table
 * — see `SalesDocumentsPanel` for the panel itself. Mirrors `McpTokensPage`'s
 * admin-gating shape.
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
      description="Choose what each connected provider issues, and which one issues first. OpenLinker never decides which document an order legally needs."
      backTo={{ to: '/settings', label: 'Settings' }}
    >
      {/*
       * #2806 — `SalesDocumentRuleEnginePanel` now composes both primary
       * tables (markets + connected providers) at the top of the page and
       * houses the older rule-engine / per-country surfaces behind an
       * advanced disclosure. See its own doc comment for the full
       * precedence and layout rationale.
       */}
      <SalesDocumentRuleEnginePanel />
    </PageLayout>
  );
}
