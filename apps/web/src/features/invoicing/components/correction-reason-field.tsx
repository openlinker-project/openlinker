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
import { useTranslation } from '../../../shared/i18n';
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
  const { t } = useTranslation();
  const length = countCodePoints(state.reason.replace(/\s+/g, ' ').trim());

  const error = state.tooLong
    ? t(
        'invoice.correction.reasonTooLong',
        `The reason can be at most ${CORRECTION_REASON_MAX_LENGTH} characters.`,
      )
    : undefined;

  return (
    <div className={['correction-reason', className].filter(Boolean).join(' ')}>
      <FormField
        name={`${name}-reason`}
        label={
          <>
            {t('invoice.correction.reasonLabel', 'Reason for correction')}{' '}
            <span className="correction-reason__hint">
              {t('invoice.correction.reasonRecommended', '(recommended)')}
            </span>
          </>
        }
        description={t(
          'invoice.correction.reasonCounter',
          `${length} / ${CORRECTION_REASON_MAX_LENGTH}`,
        )}
        error={error}
      >
        <Textarea
          placeholder={t('invoice.correction.reasonPlaceholder', 'e.g. Partial return of the order')}
          value={state.reason}
          onChange={(e) => state.setReason(e.target.value)}
          disabled={disabled}
          rows={3}
        />
      </FormField>
      {state.missingWarned ? (
        <p className="correction-reason__warning" role="status">
          {t(
            'invoice.correction.reasonMissingWarning',
            'Most corrections state why they were made, and your provider or the tax authority may expect it. Add a reason, or submit again to issue the correction without one.',
          )}
        </p>
      ) : null}
    </div>
  );
}
