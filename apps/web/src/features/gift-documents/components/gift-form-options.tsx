/**
 * GiftFormOptions (#3941)
 *
 * The one choice, the gift form on documents, as a radio group of four options
 * (gifts spec section 8.2) with an optional "as in OpenLinker" entry for the
 * connection level. "Shown at 0.00" is rendered disabled with its reason when
 * no document provider accepts a zero line, never hidden: an option that
 * vanishes reads as a bug.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { GiftDocumentFormChoiceValues, GiftFormPickerValues, type GiftDocumentFormChoice } from '../lib/gift-lines';
import { Input } from '../../../shared/ui/input';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';

export type GiftFormOptionValue = GiftDocumentFormChoice | 'inherit';

const OPTION_TEST_ID: Record<GiftDocumentFormChoice, string> = {
  'technical-cent': 'doc-gift-set-option-grosz',
  'custom-price': 'doc-gift-set-option-custom-price',
  'priced-in': 'doc-gift-set-option-priced-in',
  'show-zero': 'doc-gift-set-option-zero',
  omit: 'doc-gift-set-option-omit',
};

interface GiftFormOptionsProps {
  name: string;
  value: GiftFormOptionValue;
  onChange: (value: GiftFormOptionValue) => void;
  /** The connection level adds "As in OpenLinker (<form>)" and marks it the default. */
  inheritedForm?: GiftDocumentFormChoice;
  /**
   * The OpenLinker-wide setting is still loading or could not be read: the
   * inherit option is offered, but names no form rather than claiming the default.
   */
  inheritedUnknown?: boolean;
  /** Whether "Shown at 0.00" can be chosen at all. */
  zeroAvailable: boolean;
  /** Why it cannot, when it cannot. */
  zeroReason: string | null;
  disabled?: boolean;
  /**
   * Also offer "own price" with an amount input (#3935). Off for the settings
   * pickers, which have no amount to attach; on for a single gift added by hand.
   */
  customPrice?: {
    amount: string;
    onAmountChange: (amount: string) => void;
    currency: string;
    label: string;
  };
}

export function GiftFormOptions({
  name,
  value,
  onChange,
  inheritedForm,
  inheritedUnknown = false,
  zeroAvailable,
  zeroReason,
  disabled = false,
  customPrice,
}: GiftFormOptionsProps): ReactElement {
  const copy = useMessages('gift-documents');
  const labels = useGiftFormLabels();
  const withInherit = inheritedForm !== undefined || inheritedUnknown;

  return (
    <ul
      className="gift-form-options"
      role="radiogroup"
      aria-label={withInherit ? copy.connection.fieldLabel : copy.default.fieldLabel}
      data-testid="doc-gift-set-options"
    >
      {withInherit ? (
        <li
          className={['gift-form-option', value === 'inherit' ? 'gift-form-option--active' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <span className="gift-form-option__head">
            <label className="filter-check">
              <input
                type="radio"
                name={name}
                checked={value === 'inherit'}
                disabled={disabled}
                onChange={() => onChange('inherit')}
                data-testid="doc-gift-set-option-inherit"
              />
              <span className="filter-check__label">
                {inheritedUnknown || inheritedForm === undefined
                  ? copy.connection.inheritLabelUnknown
                  : interpolate(copy.connection.inheritLabel, { form: labels.short(inheritedForm) })}
              </span>
            </label>
            <StatusBadge tone="neutral" data-testid="doc-gift-set-option-default-badge">
              {copy.connection.defaultBadge}
            </StatusBadge>
          </span>
          <p className="gift-form-option__desc">{copy.connection.inheritDescription}</p>
        </li>
      ) : null}
      {(customPrice ? GiftDocumentFormChoiceValues : GiftFormPickerValues).map((form) => {
        const unavailable = form === 'show-zero' && !zeroAvailable;
        const isDefault = !withInherit && form === 'technical-cent';
        return (
          <li
            key={form}
            className={[
              'gift-form-option',
              value === form ? 'gift-form-option--active' : '',
              unavailable ? 'gift-form-option--disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="gift-form-option__head">
              <label className="filter-check">
                <input
                  type="radio"
                  name={name}
                  checked={value === form}
                  disabled={disabled || unavailable}
                  onChange={() => onChange(form)}
                  data-testid={OPTION_TEST_ID[form]}
                />
                <span className="filter-check__label">{labels.label(form)}</span>
              </label>
              {isDefault ? (
                <StatusBadge tone="neutral" data-testid="doc-gift-set-option-default-badge">
                  {copy.connection.defaultBadge}
                </StatusBadge>
              ) : null}
              {unavailable ? (
                <StatusBadge tone="neutral" data-testid="doc-gift-set-option-zero-badge">
                  {copy.connection.notAvailable}
                </StatusBadge>
              ) : null}
            </span>
            <p className="gift-form-option__desc">
              {unavailable && zeroReason ? zeroReason : labels.description(form)}
            </p>
            {form === 'custom-price' && customPrice && value === 'custom-price' ? (
              <label className="gift-form-option__amount">
                <span className="form-field__label">{customPrice.label}</span>
                <span className="gift-form-option__amount-input">
                  <Input
                    inputMode="decimal"
                    value={customPrice.amount}
                    disabled={disabled}
                    data-testid="doc-gift-set-custom-price-amount"
                    onChange={(event) => customPrice.onAmountChange(event.target.value)}
                  />
                  <span className="text-muted">{customPrice.currency}</span>
                </span>
              </label>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
