/**
 * CorrectionReasonField (DEF-32)
 *
 * The one "reason for correction" field every provider's correction flow
 * renders, so the five flows cannot drift apart on wording, limits or a11y.
 *
 * A missing reason is a SUGGESTION, not a block. The reason is part of most
 * correction documents, but whether a given correction must carry one is a
 * reading of the law that belongs to the operator, not to OpenLinker. So the
 * first submit without a reason shows a warning and does nothing; a second
 * submit goes ahead and the provider (or the tax authority) has the last word.
 *
 * The 256-character cap IS a block, because it is not an interpretation: the
 * FA(3) schema's text type stops there, so a longer reason is rejected by KSeF
 * after the operator moved on. It counts code points, not UTF-16 units, which
 * is what the schema counts - a native `maxLength` would cut an emoji in two.
 *
 * @module features/invoicing/components
 */
import { type ReactElement, useState } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Textarea } from '../../../shared/ui/textarea';

export const CORRECTION_REASON_MAX_LENGTH = 256;

export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

export interface CorrectionReasonState {
  reason: string;
  setReason: (value: string) => void;
  /** The reason as it goes on the wire: whitespace-collapsed, `undefined` when empty. */
  submittedReason: string | undefined;
  /** True while the operator has been warned once and has not typed a reason since. */
  missingWarned: boolean;
  tooLong: boolean;
  /**
   * Call before submitting. Returns false (and arms the warning) the first time
   * the reason is empty; returns false whenever it is too long; true otherwise.
   */
  confirmBeforeSubmit: () => boolean;
}

export function useCorrectionReason(): CorrectionReasonState {
  const [reason, setReasonValue] = useState('');
  const [missingWarned, setMissingWarned] = useState(false);
  const collapsed = reason.replace(/\s+/g, ' ').trim();
  const tooLong = countCodePoints(collapsed) > CORRECTION_REASON_MAX_LENGTH;

  function setReason(value: string): void {
    setReasonValue(value);
    if (value.trim() !== '') {
      setMissingWarned(false);
    }
  }

  function confirmBeforeSubmit(): boolean {
    if (tooLong) {
      return false;
    }
    if (collapsed === '' && !missingWarned) {
      setMissingWarned(true);
      return false;
    }
    return true;
  }

  return {
    reason,
    setReason,
    submittedReason: collapsed === '' ? undefined : collapsed,
    missingWarned: missingWarned && collapsed === '',
    tooLong,
    confirmBeforeSubmit,
  };
}

export interface CorrectionReasonFieldProps {
  state: CorrectionReasonState;
  /** Prefix for the control id, so two flows on one page never share an id. */
  name: string;
  disabled?: boolean;
  className?: string;
}

export function CorrectionReasonField({
  state,
  name,
  disabled = false,
  className,
}: CorrectionReasonFieldProps): ReactElement {
  const copy = useMessages('invoicing').invoice.correction;
  const length = countCodePoints(state.reason.replace(/\s+/g, ' ').trim());

  const error = state.tooLong
    ? interpolate(copy.reasonTooLong, { max: CORRECTION_REASON_MAX_LENGTH })
    : undefined;

  return (
    <div className={['correction-reason', className].filter(Boolean).join(' ')}>
      <FormField
        name={`${name}-reason`}
        label={
          <>
            {copy.reasonLabel}{' '}
            <span className="correction-reason__hint">
              {copy.reasonRecommended}
            </span>
          </>
        }
        description={interpolate(copy.reasonCounter, {
          length,
          max: CORRECTION_REASON_MAX_LENGTH,
        })}
        error={error}
      >
        <Textarea
          placeholder={copy.reasonPlaceholder}
          value={state.reason}
          onChange={(e) => state.setReason(e.target.value)}
          disabled={disabled}
          rows={3}
        />
      </FormField>
      {state.missingWarned ? (
        <p className="correction-reason__warning" role="status">
          {copy.reasonMissingWarning}
        </p>
      ) : null}
    </div>
  );
}
