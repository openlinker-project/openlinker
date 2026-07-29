/**
 * MCP Token List
 *
 * Active + revoked MCP tokens with a per-row revoke action (#1486).
 * Never renders a raw value or a hash — the server does not return either.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { McpToken } from '../api/mcp-tokens.types';

interface McpTokenListProps {
  tokens: McpToken[];
  onRevoke: (id: string) => void;
  isRevoking: boolean;
}

export function McpTokenList({ tokens, onRevoke, isRevoking }: McpTokenListProps): ReactElement {
  const [pendingRevoke, setPendingRevoke] = useState<McpToken | null>(null);

  if (tokens.length === 0) {
    return (
      <EmptyState
        title="No MCP tokens"
        message="Create a token to let an MCP client authenticate to this OpenLinker instance."
      />
    );
  }

  const mismatched = tokens.filter((t) => t.isActive && !t.resourceMatchesCurrent);

  return (
    <>
      {mismatched.length > 0 ? (
        <Alert tone="warning">
          {mismatched.length === 1 ? '1 token is' : `${mismatched.length} tokens are`} bound to a
          different MCP resource URL than this deployment currently serves. They will fail with a
          bare 401 until re-minted — this usually means <code className="mono-text">
            OL_MCP_RESOURCE_URL
          </code> changed after they were created.
        </Alert>
      ) : null}
      <table className="data-table data-table--stackable">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Owner</th>
            <th scope="col">Scopes</th>
            <th scope="col">Status</th>
            <th scope="col">Last used</th>
            <th scope="col">Expires</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td data-label="Name">{token.name}</td>
              <td data-label="Owner" className="mono-text">
                {token.userId}
              </td>
              <td data-label="Scopes" className="mono-text">
                {token.scopes.join(', ')}
              </td>
              <td data-label="Status">
                {token.revokedAt ? (
                  <StatusBadge tone="neutral" withDot>
                    Revoked
                  </StatusBadge>
                ) : token.isActive && !token.resourceMatchesCurrent ? (
                  <span title={`Bound to ${token.resource}`}>
                    <StatusBadge tone="warning" withDot>
                      Wrong resource
                    </StatusBadge>
                  </span>
                ) : token.isActive ? (
                  <StatusBadge tone="success" withDot>
                    Active
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning" withDot>
                    Expired
                  </StatusBadge>
                )}
              </td>
              <td data-label="Last used">
                {token.lastUsedAt ? <TimeDisplay iso={token.lastUsedAt} /> : <span>Never</span>}
              </td>
              <td data-label="Expires">
                <TimeDisplay iso={token.expiresAt} />
              </td>
              <td data-label="Actions">
                {token.revokedAt ? null : (
                  <Button
                    type="button"
                    tone="danger"
                    className="button--sm"
                    onClick={() => setPendingRevoke(token)}
                  >
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title="Revoke this token?"
        description={
          pendingRevoke
            ? `"${pendingRevoke.name}" (owner ${pendingRevoke.userId}) will stop working immediately. Any MCP client configured with it will start failing authentication. This cannot be undone.`
            : ''
        }
        confirmLabel="Revoke"
        tone="danger"
        isConfirming={isRevoking}
        onConfirm={() => {
          if (pendingRevoke) onRevoke(pendingRevoke.id);
          setPendingRevoke(null);
        }}
      />
    </>
  );
}
