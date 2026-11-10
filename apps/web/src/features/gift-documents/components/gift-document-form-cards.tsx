/**
 * GiftDocumentFormCards (#3935)
 *
 * The "On the document" choice as cards, each with a mini document that shows
 * what the choice does to the lines and the total. Optionally leads with an "As
 * in settings" card (the choice most surfaces leave alone) and opens an amount
 * field inside "Your own price". "Shown as 0.00" is listed disabled, with its
 * reason, where no document provider accepts a zero line, never hidden.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Input } from '../../../shared/ui/input';
import { RadioCardGroup, type RadioCardOption } from '../../../shared/ui/radio-card-group';
import { GiftDocumentPreview } from '../gift-document-preview';
import { useDocumentProvidersQuery } from '../hooks/use-gift-documents-queries';
import { GiftDocumentFormChoiceValues, type GiftDocumentFormChoice } from '../lib/gift-lines';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';
import { zeroAvailability } from '../lib/zero-availability';

export type GiftDocumentCardValue = GiftDocumentFormChoice | 'inherit';

/** The cards in the order the operator reads them: most common first. */
const CARD_ORDER: readonly GiftDocumentFormChoice[] = [
  'priced-in',
  'technical-cent',
  'show-zero',
  'omit',
  'custom-price',
];

export interface GiftDocumentFormCardsProps {
  name: string;
  value: GiftDocumentCardValue;
  onChange: (value: GiftDocumentCardValue) => void;
  /** The gross unit price for `custom-price`, as typed. */
  customPrice: string;
  onCustomPriceChange: (value: string) => void;
  /** Offers the "As in settings" card, naming the form it resolves to. */
  inheritedForm?: GiftDocumentFormChoice | null;
  /** The `custom-price` amount the "As in settings" card resolves to, when it does. */
  inheritedCustomPrice?: string | null;
  withInherit?: boolean;
  /** Where "Change the default" goes; omit to hide the link. */
  settingsHref?: string;
  currency?: string;
  disabled?: boolean;
  'aria-label': string;
  invalidPrice?: boolean;
}

export function GiftDocumentFormCards({
  name,
  value,
  onChange,
  customPrice,
  onCustomPriceChange,
  inheritedForm = null,
  inheritedCustomPrice = null,
  withInherit = false,
  settingsHref,
  currency = 'PLN',
  disabled = false,
  'aria-label': ariaLabel,
  invalidPrice = false,
}: GiftDocumentFormCardsProps): ReactElement {
  const copy = useMessages('gift-documents');
  const cards = copy.cards;
  const labels = useGiftFormLabels();
  const providers = useDocumentProvidersQuery();
  const zero = zeroAvailability(providers.data?.providers);
  const zeroReason = zero.refusingProviderName
    ? interpolate(copy.connection.zeroNotOffered, { provider: zero.refusingProviderName })
    : copy.connection.zeroNoProvider;

  const options: RadioCardOption<GiftDocumentCardValue>[] = [];
  if (withInherit) {
    options.push({
      value: 'inherit',
      wide: true,
      title:
        inheritedForm === null
          ? cards.inheritTitleUnknown
          : interpolate(cards.inheritTitle, { form: labels.short(inheritedForm) }),
      description: cards.inheritDescription,
      // Until the setting has been read the card names no form, and previews none:
      // claiming the built-in default would state a setting nobody read.
      preview:
        inheritedForm === null ? undefined : (
          <GiftDocumentPreview
            form={inheritedForm}
            customPrice={inheritedCustomPrice ?? undefined}
            acceptsZeroValueLine={zero.available}
            currency={currency}
          />
        ),
      footer:
        settingsHref !== undefined ? (
          <Link
            className="link pm-doccard__lnk"
            to={settingsHref}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {cards.changeDefault}
          </Link>
        ) : undefined,
      'data-testid': 'promotion-doc-inherit',
    });
  }
  for (const form of CARD_ORDER) {
    if (!(GiftDocumentFormChoiceValues as readonly string[]).includes(form)) continue;
    const unavailable = form === 'show-zero' && !zero.available;
    options.push({
      value: form,
      title: cards.forms[form].title,
      description: cards.forms[form].description,
      disabled: unavailable,
      disabledReason: unavailable ? zeroReason : undefined,
      preview: (
        <GiftDocumentPreview
          form={form}
          customPrice={form === 'custom-price' ? customPrice : undefined}
          acceptsZeroValueLine={zero.available}
          currency={currency}
        />
      ),
      panel:
        form === 'custom-price' ? (
          <>
            <span className="pm-lbl__row">
              <span className="form-field__label">{cards.customPriceLabel}</span>
            </span>
            <span className="pm-money">
              <Input
                className="mono tabular pm-doc-amt"
                inputMode="decimal"
                value={customPrice}
                aria-label={cards.customPriceLabel}
                aria-invalid={invalidPrice || undefined}
                disabled={disabled}
                onChange={(event) => {
                  onCustomPriceChange(event.target.value);
                }}
                onClick={() => {
                  if (value !== 'custom-price') onChange('custom-price');
                }}
                data-testid="promotion-doc-price"
              />
              <span>{currency === 'PLN' ? 'zł' : currency}</span>
            </span>
            {invalidPrice ? (
              <span className="pm-err pm-err--on" role="alert" data-testid="promotion-doc-price-error">
                {cards.customPriceInvalid}
              </span>
            ) : null}
          </>
        ) : undefined,
      'data-testid': `promotion-doc-${form}`,
    });
  }

  return (
    <RadioCardGroup<GiftDocumentCardValue>
      name={name}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}
