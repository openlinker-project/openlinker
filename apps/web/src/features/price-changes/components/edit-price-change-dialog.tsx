/**
 * EditPriceChangeDialog (#3148, ADR-072)
 *
 * The operator-pinned price entry: live validation (blocking error on
 * empty/non-numeric/≤0, non-blocking warning on a >30% deviation from the
 * rule-computed price), recomputed on every keystroke (`onChange`, not
 * `onBlur`), a reset to the rule price, and a permalink to the destination
 * connection's per-source rule settings (#3149).
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { formatAmount } from '../../../shared/format/format-amount';
import type { PriceChangeItem } from '../api/price-changes.types';

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

function feedbackFor(rawValue: string, rulePrice: number): Feedback {
  const parsed = Number(rawValue.replace(',', '.'));
  if (rawValue.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return { tone: 'error', message: 'Enter a price greater than 0.' };
  }
  const deviation = rulePrice > 0 ? (parsed - rulePrice) / rulePrice : 0;
  if (Math.abs(deviation) > DEVIATION_WARN_THRESHOLD) {
    const pct = Math.round(deviation * 100);
    return {
      tone: 'warn',
      message: `${pct > 0 ? '+' : ''}${pct}% vs. the rule price (${rulePrice}) - a large manual deviation.`,
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

  useEffect(() => {
    if (item) setRawValue(String(item.computedNewAmount));
  }, [item]);

  const feedback = item ? feedbackFor(rawValue, item.computedNewAmount) : { tone: null, message: '' };
  const parsed = Number(rawValue.replace(',', '.'));
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
              <label className="field__label" htmlFor="price-change-edit-input">
                Price to publish
              </label>
              <div className={`field__price-input ${feedback.tone === 'error' ? 'has-error' : ''}`}>
                <span className="field__currency">{item.destinationCurrency}</span>
                <input
                  id="price-change-edit-input"
                  type="text"
                  inputMode="decimal"
                  value={rawValue}
                  onChange={(e) => setRawValue(e.target.value)}
                />
              </div>
              <div className={`field__feedback ${feedback.tone ? `field__feedback--${feedback.tone}` : ''}`}>
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
              <Link to={`/connections/${item.destinationConnectionId}/pricing-sync?source=${item.sourceConnectionId}`}>
                Set a rule just for this source
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
