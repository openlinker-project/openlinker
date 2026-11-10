/**
 * GiftFormCards
 *
 * The one choice, the gift form on documents, as five cards with a live mini
 * document each (the redesign of the radio list). The connection level adds a
 * wide "as in settings" card first. "Shown at 0.00" stays visible and greyed
 * with its reason where no provider accepts a zero line. The "own price" card
 * carries the amount field, which opens when it is chosen.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { RadioCardGroup, type RadioCardOption } from '../../../shared/ui/radio-card-group';
import { parseGiftUnitPrice } from '../lib/gift-form-preview';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';
import { GiftDocumentPreview } from './gift-document-preview';

export type GiftFormCardValue = GiftDocumentFormChoice | 'inherit';

/** The order of the cards: left column then right, as approved. */
const CARD_ORDER: readonly GiftDocumentFormChoice[] = [
  'priced-in',
  'technical-cent',
  'show-zero',
  'omit',
  'custom-price',
];

const CARD_COPY_KEY = {
  'priced-in': 'pricedIn',
  'technical-cent': 'technicalCent',
  'show-zero': 'showZero',
  omit: 'omit',
  'custom-price': 'customPrice',
} as const;

export interface GiftFormCardsProps {
  name: string;
  value: GiftFormCardValue;
  onChange: (value: GiftFormCardValue) => void;
  /** The `custom-price` amount as typed ("2,50"). */
  amount: string;
  onAmountChange: (amount: string) => void;
  /**
   * The connection level: what "as in settings" currently means. `undefined`
   * leaves the inherit card out (the settings level); `null` form is "not read yet".
   */
  inherit?: { form: GiftDocumentFormChoice | null; unitPrice?: string | null };
  zeroAvailable: boolean;
  zeroReason: string | null;
  disabled?: boolean;
  /** Names the group for assistive tech. */
  'aria-label': string;
}

export function GiftFormCards({
  name,
  value,
  onChange,
  amount,
  onAmountChange,
  inherit,
  zeroAvailable,
  zeroReason,
  disabled = false,
  'aria-label': ariaLabel,
}: GiftFormCardsProps): ReactElement {
  const copy = useMessages('gift-documents');
  const labels = useGiftFormLabels();
  const format = useFormat();
  const parsed = parseGiftUnitPrice(amount);
  const amountInvalid = value === 'custom-price' && parsed === null;

  const options: RadioCardOption<GiftFormCardValue>[] = [];
  if (inherit !== undefined) {
    const inheritedForm = inherit.form;
    options.push({
      value: 'inherit',
      wide: true,
      title:
        inheritedForm === null
          ? copy.connectionTab.inheritTitleUnknown
          : interpolate(copy.connectionTab.inheritTitle, { form: labels.short(inheritedForm) }),
      description: copy.connectionTab.inheritDescription,
      preview:
        inheritedForm === null ? undefined : (
          <GiftDocumentPreview
            form={inheritedForm}
            unitPrice={inherit.unitPrice === undefined || inherit.unitPrice === null ? null : Number(inherit.unitPrice)}
            acceptsZero={zeroAvailable}
          />
        ),
      'data-testid': 'gift-form-card-inherit',
    });
  }
  for (const form of CARD_ORDER) {
    const card = copy.cards[CARD_COPY_KEY[form]];
    const unavailable = form === 'show-zero' && !zeroAvailable;
    options.push({
      value: form,
      title: card.title,
      description: card.description,
      reason: unavailable && zeroReason !== null ? zeroReason : undefined,
      disabled: unavailable,
      preview: (
        <GiftDocumentPreview
          form={form}
          unitPrice={form === 'custom-price' ? parsed ?? 2.5 : null}
        />
      ),
      extra:
        form === 'custom-price' ? (
          <span className="gift-amount" data-open={value === 'custom-price' ? 'true' : 'false'}>
            <span className="gift-amount__clip">
              <span className="gift-amount__inner">
                <span className="form-field__label">{copy.cards.amountLabel}</span>
                <span className="gift-amount__money">
                  <input
                    className="control mono-text"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    disabled={disabled}
                    aria-label={copy.cards.amountLabel}
                    aria-invalid={amountInvalid || undefined}
                    data-testid="gift-form-amount"
                    onClick={() => {
                      if (value !== 'custom-price' && !disabled) onChange('custom-price');
                    }}
                    onChange={(event) => onAmountChange(event.target.value)}
                    onBlur={() => {
                      if (parsed !== null) {
                        onAmountChange(
                          format.number(parsed, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        );
                      }
                    }}
                  />
                  <span aria-hidden="true">{copy.cards.currency}</span>
                </span>
                {amountInvalid ? (
                  <span className="gift-amount__error" role="alert" data-testid="gift-form-amount-error">
                    {copy.cards.amountInvalid}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        ) : undefined,
      'data-testid': `gift-form-card-${form}`,
    });
  }

  return (
    <RadioCardGroup<GiftFormCardValue>
      name={name}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

export { CARD_ORDER as GIFT_FORM_CARD_ORDER };
