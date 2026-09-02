/**
 * Sales Document Providers Page (#2806 review)
 *
 * The "Connected providers" table (`SalesDocumentsPanel`) — what each
 * connection may issue, which one goes first, and when — moved off the main
 * "Settings → Sales documents" page onto its own screen. On the combined
 * page an operator could not visually separate "what each market issues
 * right now" (`SalesDocumentMarketSection`) from "which connection is
 * configured to issue automatically" (this table): both rendered as
 * full-width tables stacked directly on top of each other with nothing
 * distinguishing where one ends and the other begins. Splitting them into
 * two pages, reached via an explicit "Manage connections & priority" link
 * from the market page, gives each its own page-level heading and
 * description instead of a shared one.
 *
 * Same admin gate as `SalesDocumentsPage` — this table sets the connection
 * every order routes fiscal documents through.
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { SalesDocumentsPanel } from '../../features/sales-documents';

export function SalesDocumentProvidersPage(): ReactElement {
  const { session } = useSession();

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout
        eyebrow="Settings"
        title="Connected providers"
        description="Admin-only access."
      >
        <ErrorState
          title="Admin role required"
          message="This page sets which connection issues sales documents — it requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Sales documents"
      title="Connected providers"
      description="Which connection issues each sales document, and its priority."
      backTo={{ to: '/settings/sales-documents', label: 'Sales documents' }}
    >
      <SalesDocumentsPanel />
    </PageLayout>
  );
}
