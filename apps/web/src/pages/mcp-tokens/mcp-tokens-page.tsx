/**
 * MCP Tokens Page
 *
 * Admin-only page for managing MCP Personal Access Tokens (#1486) — the
 * credentials an MCP client presents to authenticate against this
 * OpenLinker instance (ADR-034).
 *
 * @module apps/web/src/pages/mcp-tokens
 */
import type { ReactElement } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { useMessages } from '../../shared/i18n';
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { McpTokensPanel } from '../../features/mcp-tokens/components/mcp-tokens-panel';

export function McpTokensPage(): ReactElement {
  const { session } = useSession();
  const copy = useMessages('mcp-tokens').mcpTokensPage;

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.adminOnlyDescription}>
        <ErrorState title={copy.adminRequiredTitle} message={copy.adminRequiredMessage} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      backTo={{ to: '/settings', label: copy.backLabel }}
    >
      <McpTokensPanel />
    </PageLayout>
  );
}
