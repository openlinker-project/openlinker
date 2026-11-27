/**
 * MCP Token Reveal Dialog
 *
 * Shows a freshly-minted token's raw value EXACTLY ONCE (#1486).
 *
 * Deliberately NOT built on `CopyableId`: that primitive hover-hides its
 * copy button, which is the wrong affordance for the single most
 * security-relevant screen in this feature — the value is unrecoverable
 * once dismissed, so the copy action must be unmissable.
 *
 * The raw value lives in the parent's component state only. It is never
 * written to localStorage, never cached by TanStack Query, and never
 * re-fetchable from the server.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';

/** The literal header an MCP client sends - a protocol value, not copy. */
const AUTHORIZATION_HEADER_EXAMPLE = 'Authorization: Bearer <token>';

interface McpTokenRevealDialogProps {
  open: boolean;
  tokenName: string;
  rawToken: string;
  onDismiss: () => void;
}

export function McpTokenRevealDialog({
  open,
  tokenName,
  rawToken,
  onDismiss,
}: McpTokenRevealDialogProps): ReactElement {
  const copy = useMessages('mcp-tokens').mcpTokenRevealDialog;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(() => {
    // `navigator.clipboard` is unavailable in insecure contexts and can reject
    // on permission denial. Silence here would be worst on THIS screen — the
    // value is unrecoverable once the dialog closes.
    void navigator.clipboard
      .writeText(rawToken)
      .then(() => {
        setCopyFailed(false);
        setCopied(true);
      })
      .catch(() => setCopyFailed(true));
  }, [rawToken]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogTitle>{interpolate(copy.title, { name: tokenName })}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        <Alert tone="warning">{copy.warning}</Alert>

        <div className="mcp-token-reveal">
          <span className="mcp-token-reveal__label" id="mcp-token-raw-label">
            {copy.tokenLabel}
          </span>
          <div className="mcp-token-reveal__row">
            <code
              aria-labelledby="mcp-token-raw-label"
              className="mcp-token-reveal__value mono-text"
              data-testid="mcp-token-raw-value"
            >
              {rawToken}
            </code>
            <Button type="button" tone="primary" onClick={handleCopy}>
              {copied ? copy.copied : copy.copy}
            </Button>
          </div>
          {copyFailed ? (
            <p className="mcp-token-reveal__hint" role="alert">
              {copy.copyFailed}
            </p>
          ) : null}
          <p className="mcp-token-reveal__hint">
            {renderRich(
              copy.pasteHint,
              { code: (chunk) => <code className="mono-text">{chunk}</code> },
              { header: AUTHORIZATION_HEADER_EXAMPLE },
            )}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={onDismiss}>
            {copy.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
