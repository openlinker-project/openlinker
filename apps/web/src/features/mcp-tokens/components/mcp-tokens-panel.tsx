/**
 * MCP Tokens Panel
 *
 * Composed feature surface for the MCP token page (#1486): tool-availability
 * note + create form + list + one-time reveal. Owns the raw-token state for
 * the reveal, which lives here and nowhere else — dropped on dismiss, never
 * persisted.
 *
 * The tool-availability note (#1932) is here rather than on the page because
 * an operator reads it while wiring a client, and because this is the surface
 * with a test harness. It is copy only — OL serves MCP statelessly, so there
 * is no session to push `notifications/tools/list_changed` over (ADR-033), and
 * closing that gap would mean adopting sessions, not adding UI.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useToast } from '../../../shared/ui/toast-provider';
import { MCP_TOOL_AVAILABILITY_NOTE } from '../lib/tool-staleness-copy';
import { useMcpTokensQuery } from '../hooks/use-mcp-tokens-query';
import { useCreateMcpTokenMutation } from '../hooks/use-create-mcp-token-mutation';
import { useRevokeMcpTokenMutation } from '../hooks/use-revoke-mcp-token-mutation';
import { McpTokenCreateForm } from './mcp-token-create-form';
import { McpTokenList } from './mcp-token-list';
import { McpTokenRevealDialog } from './mcp-token-reveal-dialog';

interface RevealedToken {
  name: string;
  rawToken: string;
}

export function McpTokensPanel(): ReactElement {
  const [revealed, setRevealed] = useState<RevealedToken | null>(null);
  const { showToast } = useToast();

  const tokensQuery = useMcpTokensQuery();
  const createMutation = useCreateMcpTokenMutation();
  const revokeMutation = useRevokeMcpTokenMutation();

  return (
    <div className="mcp-tokens-panel">
      <Alert tone="info">{MCP_TOOL_AVAILABILITY_NOTE}</Alert>

      <article className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Create</p>
            <h3 className="section-title">New MCP token</h3>
          </div>
          <span className="panel__meta">Admin only</span>
        </div>
        {createMutation.isError ? (
          <Alert tone="error">{createMutation.error.message}</Alert>
        ) : null}
        <McpTokenCreateForm
          isSubmitting={createMutation.isPending}
          onSubmit={(input) => {
            createMutation.mutate(input, {
              onSuccess: (created) => {
                setRevealed({ name: created.name, rawToken: created.rawToken });
              },
            });
          }}
        />
      </article>

      <article className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Existing</p>
            <h3 className="section-title">MCP tokens</h3>
          </div>
        </div>

        {tokensQuery.isLoading ? <LoadingState title="Loading tokens" message="Fetching MCP tokens…" /> : null}
        {tokensQuery.isError ? (
          <ErrorState title="Could not load tokens" message={tokensQuery.error.message} />
        ) : null}
        {tokensQuery.data ? (
          <McpTokenList
            tokens={tokensQuery.data}
            isRevoking={revokeMutation.isPending}
            onRevoke={(id) => {
              revokeMutation.mutate(id, {
                onSuccess: () =>
                  showToast({
                    tone: 'success',
                    title: 'Token revoked',
                    description: 'Any MCP client using it will stop authenticating.',
                  }),
                onError: (error) =>
                  showToast({ tone: 'error', title: 'Could not revoke', description: error.message }),
              });
            }}
          />
        ) : null}
      </article>

      {revealed ? (
        <McpTokenRevealDialog
          open
          tokenName={revealed.name}
          rawToken={revealed.rawToken}
          onDismiss={() => setRevealed(null)}
        />
      ) : null}
    </div>
  );
}
