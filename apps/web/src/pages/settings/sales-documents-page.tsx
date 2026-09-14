/**
 * Sales Documents Page (#2159)
 *
 * Admin-only page hosting the centralized "Settings → Sales documents" view.
 * Mirrors `McpTokensPage`'s admin-gating shape.
 *
 * TWO SECTIONS, IN THIS ORDER (mockup `sales-document-routing.html`):
 *
 *   1. `SalesDocumentRuleEnginePanel` — the primary authoring surface (#2170 /
 *      M7 / #2550). ONE market table plus the per-country routing dialog.
 *   2. `SalesDocumentsPanel` — the mockup's "Connected providers" table. It is
 *      DEMOTED below the market list, never removed: it is the only place a
 *      connection's document kind, "goes first" and trigger model are set at
 *      all, and a connection with nothing set there is not a routing candidate
 *      for the rule engine either (`architecture-overview.md § Invoicing`,
 *      #2156). Deleting it left an install with no way to make auto-issue fire
 *      — `config.invoicing.triggerModel` defaults to `manual`, so a fully
 *      authored rule set still issued nothing (#2809 review, BLOCKING 3).
 *
 * @module apps/web/src/pages/settings
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { SalesDocumentRuleEnginePanel, SalesDocumentsPanel } from '../../features/sales-documents';

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
      description="Choose what each market issues, per country, and what each connected provider may issue. OpenLinker never decides which document an order legally needs."
      backTo={{ to: '/settings', label: 'Settings' }}
    >
      <SalesDocumentRuleEnginePanel />
      <SalesDocumentsPanel />
    </PageLayout>
  );
}
