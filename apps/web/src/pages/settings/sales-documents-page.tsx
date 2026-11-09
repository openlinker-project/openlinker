/**
 * Sales Documents Page (#2159)
 *
 * Admin-only page hosting the centralized "Settings -> Sales documents routing" view.
 * The route path keeps its original `/settings/sales-documents` spelling: it is
 * a persisted link target, and #3307 renamed only what an operator reads.
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
import { HelpLink } from '../../shared/ui/help-link';
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';
import { SalesDocumentRuleEnginePanel, SalesDocumentsPanel } from '../../features/sales-documents';

export function SalesDocumentsPage(): ReactElement {
  const { session } = useSession();
  const copy = useMessages('settings').salesDocumentsPage;

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnly.description}>
        <ErrorState
          title={copy.adminOnly.title}
          message={copy.adminOnly.message}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      backTo={{ to: '/settings', label: copy.backLabel }}
      actions={<HelpLink surfaceKey="sales-documents-routing" />}
    >
      <SalesDocumentRuleEnginePanel />
      <SalesDocumentsPanel />
    </PageLayout>
  );
}
