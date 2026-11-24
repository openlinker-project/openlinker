/**
 * Buyer Data Trial Run (#4289)
 *
 * The "Check now" action and what it answers: how many orders the rules would
 * touch, with a few masked sample orders. It changes nothing, and having seen
 * the answer is what lets the operator turn the rules on.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import type { BuyerDataPreview } from '../api/buyer-data.types';

export interface BuyerDataTrialProps {
  result: BuyerDataPreview | undefined;
  isPending: boolean;
  isError: boolean;
  disabled: boolean;
  /** ISO instant of the last successful check, if any. */
  checkedAt?: string;
  /** The rules changed after the check, so its numbers describe other rules. */
  stale?: boolean;
  onRun: () => void;
}

export function BuyerDataTrial({
  result,
  isPending,
  isError,
  disabled,
  checkedAt,
  stale = false,
  onRun,
}: BuyerDataTrialProps): ReactElement {
  const copy = useMessages('buyer-data').section;
  const format = useFormat();

  return (
    <div data-testid="buyer-data-trial">
      <p className="rate-limit-section__help">{copy.checkBody}</p>
      <div className="form-actions">
        <Button
          type="button"
          tone="secondary"
          disabled={disabled || isPending}
          onClick={onRun}
          data-testid="buyer-data-trial-run"
        >
          {isPending ? copy.checking : copy.checkNow}
        </Button>
      </div>
      {isError ? <Alert tone="error">{copy.checkError}</Alert> : null}
      {result !== undefined ? (
        <Alert
          tone={stale ? 'warning' : 'success'}
          title={copy.checkTitle}
          data-testid="buyer-data-trial-result"
        >
          {stale ? <p>{copy.checkStale}</p> : null}
          {checkedAt !== undefined && !stale ? (
            <p className="muted-text">{interpolate(copy.checkedAt, { time: format.time(checkedAt) })}</p>
          ) : null}
          {interpolate(copy.checkDone, {
            total: format.number(result.total),
            toHide: format.number(result.toHide),
            toErase: format.number(result.toErase),
          })}
          {result.samples.length > 0 ? (
            <>
              <p className="muted-text">{copy.sampleLabel}</p>
              <KeyValueList
                items={result.samples.map((sample) => ({
                  id: sample.orderRef,
                  label: `${sample.orderRef} · ${sample.maskedBuyer}`,
                  value: format.date(sample.placedAt),
                }))}
              />
            </>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
