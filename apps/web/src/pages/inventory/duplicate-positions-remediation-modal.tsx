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
import { Button } from '../../shared/ui/button';
import { Textarea } from '../../shared/ui/textarea';
import { Alert } from '../../shared/ui/alert';
import { buildRemediationDeleteSql } from '../../features/inventory/lib/duplicate-positions-remediation';
import type { DuplicatePositionGroup } from '../../features/inventory/api/inventory.types';

const REMEDIATION_RUNBOOK_PATH = 'docs/operations/inventory-duplicate-positions.md';

export interface DuplicatePositionsRemediationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = opened generically (e.g. from the not-ready banner). */
  group: DuplicatePositionGroup | null;
}

export function DuplicatePositionsRemediationModal({
  open,
  onOpenChange,
  group,
}: DuplicatePositionsRemediationModalProps): ReactElement {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const deletion = group ? buildRemediationDeleteSql(group) : null;

  const handleCopy = useCallback(() => {
    if (!deletion?.sql) return;
    void navigator.clipboard.writeText(deletion.sql).then(() => setCopied(true));
  }, [deletion]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Remediation guide (condensed)</DialogTitle>
        {group ? (
          <DialogDescription className="mono-text">
            {group.productName ?? group.productId}
            {group.sku ? ` (${group.sku})` : ''} · {group.productVariantId ?? group.productId}
          </DialogDescription>
        ) : null}

        <ol className="duplicate-positions-remediation-steps">
          <li>
            <strong>Pick the survivor.</strong> The live row (not stale) with the highest{' '}
            <code>updatedAt</code> — normally the first row, since rows are newest-first.
          </li>
          <li>
            <strong>Every row stale?</strong> Keep the newest and delete the rest, or delete the
            whole group if the product is genuinely gone at the master.
          </li>
          <li>
            <strong>Reconcile the survivor&rsquo;s quantity from the master</strong>, not from the
            other rows — the next sync overwrites it anyway.
          </li>
          <li>
            <strong>Delete the losers by primary key only.</strong> A <code>DELETE</code> keyed on
            the position columns can&rsquo;t express &ldquo;all but one&rdquo; and empties the
            whole group.
          </li>
          <li>
            <strong>Re-run this report</strong> until <code>groupCount</code> reads 0, then proceed
            to the migration.
          </li>
        </ol>

        <Alert tone="warning">
          Never sum the duplicated quantities when reconciling — that recreates, by hand, the exact
          over-count this report exists to catch, and the next sync won&rsquo;t correct it because
          it will look like a real master figure.
        </Alert>

        {group && deletion?.sql ? (
          ((): ReactElement => {
            const survivorNotePrefix =
              group.liveRowCount > 0
                ? 'Survivor (live, newest):'
                : 'No live row in this group — keeping the newest overall per step 2:';
            return (
              <>
                <p className="duplicate-positions-remediation-steps__note">
                  {survivorNotePrefix} <code>{deletion.survivor?.id}</code>
                </p>
                <p className="duplicate-positions-remediation-steps__sql-label">
                  DELETE for the {deletion.losers.length} loser row
                  {deletion.losers.length === 1 ? '' : 's'} in this group
                </p>
                <Textarea readOnly rows={3} value={deletion.sql} />
                <div className="duplicate-positions-remediation-steps__sql-actions">
                  <Button tone="secondary" className="button--sm" onClick={handleCopy}>
                    Copy
                  </Button>
                  {copied ? (
                    <span className="duplicate-positions-remediation-steps__copy-note">
                      ✓ Copied
                    </span>
                  ) : null}
                  <span className="duplicate-positions-remediation-steps__sql-hint">
                    Nothing on this page runs this — re-confirm these ids are still current
                    (re-run the scan), then run it yourself.
                  </span>
                </div>
              </>
            );
          })()
        ) : group ? null : (
          <p className="duplicate-positions-remediation-steps__note">
            Open this from a specific group&rsquo;s row instead to get a ready-to-review{' '}
            <code>DELETE</code> for that group&rsquo;s losers.
          </p>
        )}

        <DialogFooter>
          <span className="duplicate-positions-remediation-steps__footer-hint">
            This is an excerpt. The committed doc has the full ordering dependency, the stale-group
            fallback and the SQL caveats.
          </span>
          <div className="duplicate-positions-remediation-steps__footer-actions">
            <Button tone="secondary" className="button--sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <a
              className="button button--sm"
              href={`https://github.com/openlinker-project/openlinker/blob/main/${REMEDIATION_RUNBOOK_PATH}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full runbook →
            </a>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
