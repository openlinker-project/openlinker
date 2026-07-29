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
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';

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
        <DialogTitle>Token created — {tokenName}</DialogTitle>
        <DialogDescription>Copy this token now. It cannot be shown again.</DialogDescription>

        <Alert tone="warning">
          This is the only time this value is displayed. OpenLinker stores only a hash of it — if you
          lose it, revoke the token and create a new one.
        </Alert>

        <div className="mcp-token-reveal">
          <span className="mcp-token-reveal__label" id="mcp-token-raw-label">
            Token
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
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {copyFailed ? (
            <p className="mcp-token-reveal__hint" role="alert">
              Copying failed — select the value above and copy it manually before closing.
            </p>
          ) : null}
          <p className="mcp-token-reveal__hint">
            Paste it into your MCP client&apos;s configuration as an{' '}
            <code className="mono-text">Authorization: Bearer &lt;token&gt;</code> header.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={onDismiss}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
