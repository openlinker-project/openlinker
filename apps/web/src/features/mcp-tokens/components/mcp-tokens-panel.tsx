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
import { describeApiError } from '../../../shared/api/describe-api-error';
import { Alert } from '../../../shared/ui/alert';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useMessages } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
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
  const messages = useMessages('mcp-tokens');
  const copy = messages.mcpTokensPanel;

  const tokensQuery = useMcpTokensQuery();
  const createMutation = useCreateMcpTokenMutation();
  const revokeMutation = useRevokeMcpTokenMutation();

  return (
    <div className="mcp-tokens-panel">
      <Alert tone="info">{messages.toolStaleness.availabilityNote}</Alert>

      <article className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{copy.createEyebrow}</p>
            <h3 className="section-title">{copy.createTitle}</h3>
          </div>
          <span className="panel__meta">{copy.adminOnly}</span>
        </div>
        {createMutation.isError ? (
          <Alert tone="error">{describeApiError(createMutation.error, 'mcp-tokens')}</Alert>
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
            <p className="eyebrow">{copy.existingEyebrow}</p>
            <h3 className="section-title">{copy.existingTitle}</h3>
          </div>
        </div>

        {tokensQuery.isLoading ? <LoadingState title={copy.loadingTitle} message={copy.loadingMessage} /> : null}
        {tokensQuery.isError ? (
          <ErrorState title={copy.loadErrorTitle} message={describeApiError(tokensQuery.error, 'mcp-tokens')} />
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
                    title: copy.revokedToastTitle,
                    description: copy.revokedToastDescription,
                  }),
                onError: (error) =>
                  showToast({ tone: 'error', title: copy.revokeErrorTitle, description: describeApiError(error, 'mcp-tokens') }),
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
