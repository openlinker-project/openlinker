/**
 * MCP Token List
 *
 * Active + revoked MCP tokens with a per-row revoke action (#1486).
 * Never renders a raw value or a hash — the server does not return either.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
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
  const copy = useMessages('mcp-tokens').mcpTokenList;
  const plural = usePlural();

  if (tokens.length === 0) {
    return (
      <EmptyState
        title={copy.emptyTitle}
        message={copy.emptyMessage}
      />
    );
  }

  const mismatched = tokens.filter((t) => t.isActive && !t.resourceMatchesCurrent);

  return (
    <>
      {mismatched.length > 0 ? (
        <Alert tone="warning">{plural(mismatched.length, copy.wrongResourceWarning)}</Alert>
      ) : null}
      <table className="data-table data-table--stackable">
        <thead>
          <tr>
            <th scope="col">{copy.columns.name}</th>
            <th scope="col">{copy.columns.owner}</th>
            <th scope="col">{copy.columns.scopes}</th>
            <th scope="col">{copy.columns.status}</th>
            <th scope="col">{copy.columns.lastUsed}</th>
            <th scope="col">{copy.columns.expires}</th>
            <th scope="col">
              <span className="sr-only">{copy.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td data-label={copy.columns.name}>{token.name}</td>
              <td data-label={copy.columns.owner} className="mono-text">
                {token.userId}
              </td>
              <td data-label={copy.columns.scopes} className="mono-text">
                {token.scopes.join(', ')}
              </td>
              <td data-label={copy.columns.status}>
                {token.revokedAt ? (
                  <StatusBadge tone="neutral" withDot>
                    {copy.status.revoked}
                  </StatusBadge>
                ) : token.isActive && !token.resourceMatchesCurrent ? (
                  <span title={interpolate(copy.boundTo, { resource: token.resource })}>
                    <StatusBadge tone="warning" withDot>
                      {copy.status.wrongResource}
                    </StatusBadge>
                  </span>
                ) : token.isActive ? (
                  <StatusBadge tone="success" withDot>
                    {copy.status.active}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning" withDot>
                    {copy.status.expired}
                  </StatusBadge>
                )}
              </td>
              <td data-label={copy.columns.lastUsed}>
                {token.lastUsedAt ? <TimeDisplay iso={token.lastUsedAt} /> : <span>{copy.never}</span>}
              </td>
              <td data-label={copy.columns.expires}>
                <TimeDisplay iso={token.expiresAt} />
              </td>
              <td data-label={copy.columns.actions}>
                {token.revokedAt ? null : (
                  <Button
                    type="button"
                    tone="danger"
                    className="button--sm"
                    onClick={() => setPendingRevoke(token)}
                  >
                    {copy.revoke}
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
        title={copy.confirmTitle}
        description={
          pendingRevoke
            ? interpolate(copy.confirmDescription, {
                name: pendingRevoke.name,
                owner: pendingRevoke.userId,
              })
            : ''
        }
        confirmLabel={copy.confirmLabel}
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
