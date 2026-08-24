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
import { SalesDocumentsPanel, SalesDocumentRuleEnginePanel } from '../../features/sales-documents';

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
      <SalesDocumentsPanel />
      {/*
       * #2170 — the country-agnostic rule engine, rendered alongside the
       * #2156 operator-configured table above rather than replacing it:
       * `AutoIssueTriggerService` still resolves via that table today, so
       * removing it would leave operators unable to configure what
       * actually auto-issues. See `SalesDocumentRuleEnginePanel`'s own doc
       * comment.
       */}
      <SalesDocumentRuleEnginePanel />
    </PageLayout>
  );
}
