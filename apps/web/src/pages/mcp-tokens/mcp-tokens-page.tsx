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
import { ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { McpTokensPanel } from '../../features/mcp-tokens/components/mcp-tokens-panel';

export function McpTokensPage(): ReactElement {
  const { session } = useSession();

  if (session.status === 'authenticated' && session.user?.role !== 'admin') {
    return (
      <PageLayout eyebrow="Settings" title="MCP tokens" description="Admin-only access.">
        <ErrorState
          title="Admin role required"
          message="This page manages agent credentials — it requires an admin session."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Settings"
      title="MCP tokens"
      description="Personal access tokens that let an MCP client (Claude Desktop, an agent, …) authenticate to this OpenLinker instance."
      backTo={{ to: '/settings', label: 'Settings' }}
    >
      <McpTokensPanel />
    </PageLayout>
  );
}
