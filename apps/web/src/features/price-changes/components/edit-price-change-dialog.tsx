/**
 * EditPriceChangeDialog (#3148, ADR-072)
 *
 * The operator-pinned price entry: live validation (blocking error on
 * empty/non-numeric/≤0, non-blocking warning on a >30% deviation from the
 * rule-computed price), recomputed on every keystroke (`onChange`, not
 * `onBlur`), a reset to the rule price, and a permalink to the destination
 * connection's edit page.
 *
 * **Number parsing (#3148 review, finding 7)** goes through
 * `parseLocalizedAmount` rather than a naive `replace(',', '.')`, which only
 * ever rewrites the FIRST comma and mis-parses a thousands-grouped value
 * like `1 234,56` or `1.234,56` as `NaN`. The confirmed value is also
 * clamped to the storage column's 4-decimal precision
 * (`clampToStorablePrecision`) so the operator sees what will actually be
 * saved rather than being surprised by a silent server-side truncation.
 *
 * **Accessibility (#3148 review, finding 6)**: the input carries
 * `aria-invalid`/`aria-describedby` wired to the feedback paragraph, and an
 * ERROR-toned feedback message is additionally `role="alert"` so a
 * screen-reader user is told about it without having to re-visit the field.
 *
 * **Permalink target (#3148 review, finding 10)**: this stack does not yet
 * carry the dedicated `/connections/:id/pricing-sync` settings page (#3149,
 * #3150 — separate, not-yet-landed siblings), so linking there would 404.
 * Points at the existing connection edit page instead; revisit once that
 * page ships.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { formatAmount } from '../../../shared/format/format-amount';
import type { PriceChangeItem } from '../api/price-changes.types';
import { clampToStorablePrecision, parseLocalizedAmount } from '../lib/price-change-copy';

interface EditPriceChangeDialogProps {
  item: PriceChangeItem | null;
  onOpenChange: (open: boolean) => void;
  isConfirming?: boolean;
  onConfirm: (manualPriceOverride: number) => void;
}

const DEVIATION_WARN_THRESHOLD = 0.3;

interface Feedback {
  tone: 'error' | 'warn' | null;
  message: string;
}

function feedbackFor(rawValue: string, rulePrice: number, currency: string | null | undefined): Feedback {
  const parsed = parseLocalizedAmount(rawValue);
  if (rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return { tone: 'error', message: 'Enter a price greater than 0.' };
  }
  const deviation = rulePrice > 0 ? (parsed - rulePrice) / rulePrice : 0;
  if (Math.abs(deviation) > DEVIATION_WARN_THRESHOLD) {
    const pct = Math.round(deviation * 100);
    return {
      tone: 'warn',
      message: `${pct > 0 ? '+' : ''}${pct}% vs. the rule price (${formatAmount(rulePrice, currency ?? undefined)}) - a large manual deviation.`,
    };
  }
  return { tone: null, message: '' };
}

export function EditPriceChangeDialog({
  item,
  onOpenChange,
  isConfirming = false,
  onConfirm,
}: EditPriceChangeDialogProps): ReactElement {
  const [rawValue, setRawValue] = useState('');
  const generatedId = useId();
  const inputId = `price-change-edit-input-${generatedId}`;
  const feedbackId = `${inputId}-feedback`;

  useEffect(() => {
    if (item) setRawValue(String(item.computedNewAmount));
  }, [item]);

  const feedback = item
    ? feedbackFor(rawValue, item.computedNewAmount, item.destinationCurrency)
    : { tone: null, message: '' };
  const parsed = clampToStorablePrecision(parseLocalizedAmount(rawValue));
  const canConfirm = feedback.tone !== 'error' && !isConfirming;

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Enter your own price</DialogTitle>
        {item ? (
          <>
            <DialogDescription>
              {item.productName} on {item.destinationLabel}
            </DialogDescription>
            <p className="rule-note">
              Source ({item.sourceLabel}): <b>{formatAmount(item.sourceOldAmount, item.sourceCurrency)} →{' '}
              {formatAmount(item.sourceNewAmount, item.sourceCurrency)}</b>.
            </p>
            <div className="field">
              <label className="form-field__label" htmlFor={inputId}>
                Price to publish
              </label>
              <div className={`field__price-input ${feedback.tone === 'error' ? 'has-error' : ''}`}>
                <span className="field__currency">{item.destinationCurrency}</span>
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  value={rawValue}
                  aria-invalid={feedback.tone === 'error'}
                  aria-describedby={feedback.message ? feedbackId : undefined}
                  onChange={(e) => setRawValue(e.target.value)}
                />
              </div>
              <div
                id={feedbackId}
                className={`field__feedback ${feedback.tone ? `field__feedback--${feedback.tone}` : ''}`}
                role={feedback.tone === 'error' ? 'alert' : undefined}
              >
                {feedback.message}
              </div>
              <div className="field__hint">
                Left alone, the usual rule would set this to{' '}
                <span className="mono">{formatAmount(item.computedNewAmount, item.destinationCurrency)}</span>.{' '}
                <button type="button" onClick={() => setRawValue(String(item.computedNewAmount))}>
                  Use that price
                </button>
              </div>
            </div>
            <p className="field__link-row">
              This only changes this one price. Want every future change from this source to use a
              different rule?{' '}
              <Link to={`/connections/${item.destinationConnectionId}/edit`}>
                Manage this connection&apos;s pricing rules
              </Link>
              .
            </p>
          </>
        ) : null}
        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} onClick={() => onConfirm(parsed)}>
            {isConfirming ? 'Publishing…' : 'Publish this price'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
