/**
 * Duplicate Positions Remediation Modal
 *
 * Per the mockup's "Remediation guide (condensed)" dialog. Always shows the
 * 5-step manual-remediation guide; when opened from a specific group it
 * additionally resolves that group's survivor (the same rule
 * `findSurvivorId` uses) and renders a ready-to-review `DELETE` for its
 * losers. Nothing here executes anything — copy-and-run-yourself, matching
 * "it detects, it never writes."
 *
 * @module apps/web/src/pages/inventory
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../shared/ui/dialog';
import { renderRich, useMessages, usePlural } from '../../shared/i18n';
import { Button } from '../../shared/ui/button';
import { Textarea } from '../../shared/ui/textarea';
import { Alert } from '../../shared/ui/alert';
import {
  buildRemediationDeleteSql,
  type RemediationDeletion,
} from '../../features/inventory/lib/duplicate-positions-remediation';
import type { DuplicatePositionGroup } from '../../features/inventory/api/inventory.types';

const REMEDIATION_RUNBOOK_PATH = 'docs/operations/inventory-duplicate-positions.md';
/**
 * No configurable docs-base exists in the tree yet, so this is a single,
 * named edit point rather than a scattered literal — a self-hosted install
 * (possibly a fork, possibly air-gapped) pointing this at someone else's
 * `main` is a real gap (#3264 review), but wiring a deployment-configurable
 * docs base is a separate change with no existing precedent to follow.
 */
const OPENLINKER_REPO_BASE_URL = 'https://github.com/openlinker-project/openlinker';

export interface DuplicatePositionsRemediationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = opened generically (e.g. from the not-ready banner). */
  group: DuplicatePositionGroup | null;
}

/**
 * The survivor call-out + generated `DELETE` block, rendered only when a
 * specific group was opened. Its own component so the Copy affordance's
 * accessible name — not a sibling status text — is what announces the copy
 * to assistive tech, matching `shared/ui/copyable-id.tsx` (and
 * `entity-label.tsx` / `raw-payload-panel.tsx` / `structured-error-list.tsx`):
 * the button's own `aria-label` toggles between "Copy …" and "Copied …"
 * rather than relying on a plain visible `<span>` nobody's screen reader is
 * told about.
 */
function RemediationDeleteBlock({
  group,
  deletion,
}: {
  group: DuplicatePositionGroup;
  deletion: RemediationDeletion;
}): ReactElement {
  const copy = useMessages('inventory').duplicatePositionsRemediationModal;
  const plural = usePlural();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(() => {
    if (!deletion.sql) return;
    // `navigator.clipboard` is `undefined` outside a secure context — this is
    // a self-hosted product routinely run over plain `http://` on a LAN,
    // where a non-optional call throws synchronously inside the click
    // handler (#3264 review). Matches the `copyable-id.tsx` precedent.
    void navigator.clipboard
      ?.writeText(deletion.sql)
      .then(() => setCopied(true))
      .catch(() => {
        // Permissions-policy denial or an unsupported browser — nothing to
        // recover; swallow rather than an unhandled rejection.
      });
  }, [deletion]);

  if (!deletion.sql) return <></>;

  const survivorNotePrefix = group.liveRowCount > 0 ? copy.survivorLive : copy.survivorNoLive;
  const loserCount = deletion.losers.length;

  return (
    <>
      <p className="duplicate-positions-remediation-steps__note">
        {survivorNotePrefix} <code>{deletion.survivor?.id}</code>
      </p>
      <p className="duplicate-positions-remediation-steps__sql-label">
        {plural(loserCount, copy.sqlLabel)}
      </p>
      <Textarea readOnly rows={3} value={deletion.sql} />
      <div className="duplicate-positions-remediation-steps__sql-actions">
        <Button
          tone="secondary"
          className="button--sm"
          onClick={handleCopy}
          aria-label={plural(loserCount, copied ? copy.copiedDelete : copy.copyDelete)}
        >
          {copied ? copy.copied : copy.copy}
        </Button>
        <span className="duplicate-positions-remediation-steps__sql-hint">{copy.sqlHint}</span>
      </div>
    </>
  );
}

export function DuplicatePositionsRemediationModal({
  open,
  onOpenChange,
  group,
}: DuplicatePositionsRemediationModalProps): ReactElement {
  const copy = useMessages('inventory').duplicatePositionsRemediationModal;
  const rich = {
    strong: (text: string) => <strong>{text}</strong>,
    code: (text: string) => <code>{text}</code>,
  };
  const deletion = group ? buildRemediationDeleteSql(group) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{copy.title}</DialogTitle>
        {group ? (
          <DialogDescription className="mono-text">
            {group.productName ?? group.productId}
            {group.sku ? ` (${group.sku})` : ''} · {group.productVariantId ?? group.productId}
          </DialogDescription>
        ) : null}

        <ol className="duplicate-positions-remediation-steps">
          <li>{renderRich(copy.steps.pick, rich)}</li>
          <li>{renderRich(copy.steps.allStale, rich)}</li>
          <li>{renderRich(copy.steps.reconcile, rich)}</li>
          <li>{renderRich(copy.steps.deleteLosers, rich)}</li>
          <li>{renderRich(copy.steps.rerun, rich)}</li>
        </ol>

        <Alert tone="warning">{copy.neverSum}</Alert>

        {group && deletion?.sql ? (
          <RemediationDeleteBlock group={group} deletion={deletion} />
        ) : group ? null : (
          <p className="duplicate-positions-remediation-steps__note">
            {renderRich(copy.openFromGroup, rich)}
          </p>
        )}

        <DialogFooter>
          <span className="duplicate-positions-remediation-steps__footer-hint">
            {copy.footerHint}
          </span>
          <div className="duplicate-positions-remediation-steps__footer-actions">
            <Button tone="secondary" className="button--sm" onClick={() => onOpenChange(false)}>
              {copy.close}
            </Button>
            <a
              className="button button--sm"
              href={`${OPENLINKER_REPO_BASE_URL}/blob/main/${REMEDIATION_RUNBOOK_PATH}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.openRunbook}
            </a>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
