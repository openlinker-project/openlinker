/**
 * AcceptPriceChangeDialog (#3148, ADR-072)
 *
 * The single-accept confirm: price hero (old → new), the rule sentence, the
 * "also set to Automatic" opt-in (writes via `useSetSourceSyncModeMutation`
 * in the SAME confirm — see this file's own note on the sequencing
 * discrepancy below), and the fixed "never touches an already-placed order"
 * disclaimer.
 *
 * **Sequencing note (#3148's own stated assumption, resolved differently):**
 * the issue assumed the "set to Automatic" write would be a SEPARATE mutation
 * call after accept succeeds. #3145/#3146 shipped `optInAutomatic` as part of
 * the SAME `accept`/`edit` request body (one call, not two) — the backend
 * itself does the read-modify-write server-side. This dialog therefore passes
 * `optInAutomatic` straight through to `onAccept`, and the Undo toast (in
 * `price-changes-queue-table.tsx`) calls `useSetSourceSyncModeMutation` to
 * revert the mode back to `manual` — a genuine second call, but only on the
 * UNDO path, never on the happy path.
 *
 * **The "also set to Automatic" opt-in is admin-only, and is hidden rather
 * than merely disabled for anyone else (#3148 review, finding 2).** The
 * `POST .../accept` endpoint's own `optInAutomatic` field is `@Roles('admin')`
 * regardless of the wider `admin`/`operator` accept gate (it mutates
 * `Connection.config`, an admin-only surface), and the Undo toast this opt-in
 * offers calls the same admin-only `PATCH /connections/:id/pricing-sync`. An
 * operator who could tick the box but not undo it is the exact role
 * mismatch this hides — by never rendering the checkbox for a non-admin
 * session, that session can never reach a state only an admin can revert.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { formatAmount } from '../../../shared/format/format-amount';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import type { PriceChangeItem } from '../api/price-changes.types';
import { ruleSentenceFor } from '../lib/price-change-copy';

interface AcceptPriceChangeDialogProps {
  item: PriceChangeItem | null;
  onOpenChange: (open: boolean) => void;
  isConfirming?: boolean;
  onConfirm: (optInAutomatic: boolean) => void;
}

export function AcceptPriceChangeDialog({
  item,
  onOpenChange,
  isConfirming = false,
  onConfirm,
}: AcceptPriceChangeDialogProps): ReactElement {
  const [optInAutomatic, setOptInAutomatic] = useState(false);
  const isAdmin = useIsAdmin();
  const open = item !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOptInAutomatic(false);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle>Publish new price</DialogTitle>
        {item ? (
          <>
            <DialogDescription>
              {item.productName} on {item.destinationLabel} — from {item.sourceLabel}
            </DialogDescription>
            <div className="price-hero">
              <div className="price-hero__block">
                <div className="price-hero__label">Live now</div>
                <div className="price-hero__value price-hero__value--old">
                  {item.computedOldAmount === null
                    ? '—'
                    : formatAmount(item.computedOldAmount, item.destinationCurrency ?? undefined)}
                </div>
              </div>
              <div className="price-hero__arrow" aria-hidden="true">
                →
              </div>
              <div className="price-hero__block">
                <div className="price-hero__label">Will publish</div>
                <div className="price-hero__value price-hero__value--new">
                  {formatAmount(item.computedNewAmount, item.destinationCurrency ?? undefined)}
                </div>
              </div>
            </div>
            <p className="rule-note">
              {ruleSentenceFor(item.ruleSummary)} That comes to{' '}
              <b>
                {formatAmount(
                  item.manualPriceOverride ?? item.computedNewAmount,
                  item.destinationCurrency ?? undefined,
                )}
              </b>
              , VAT included.
            </p>
            {isAdmin ? (
              <label className="opt-in-check">
                <input
                  type="checkbox"
                  checked={optInAutomatic}
                  onChange={(e) => setOptInAutomatic(e.target.checked)}
                />
                <span>
                  <span className="opt-in-check__title">
                    Also set {item.sourceLabel} → {item.destinationLabel} to Automatic
                  </span>
                  <span className="opt-in-check__desc">
                    Next time this source&apos;s price changes, it&apos;ll go straight to this
                    connection — no review needed.
                  </span>
                </span>
              </label>
            ) : null}
            <p className="rule-note rule-note--muted">
              This changes the live listing&apos;s price only — orders already placed keep the
              price they were bought at.
            </p>
          </>
        ) : null}
        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isConfirming} onClick={() => onConfirm(optInAutomatic)}>
            {isConfirming ? 'Publishing…' : 'Publish price'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
