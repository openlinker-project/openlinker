/**
 * Bundle form, step 3: gifts and documents (#3935)
 *
 * For every component marked as a gift, one dropdown for how it looks on a sales
 * document. "As in settings" is not left abstract: it names the form the
 * settings resolve to right now, and each option says in one line what it does
 * to the document. A mini document under the choice shows the result.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { DescribedSelect, type DescribedSelectOption } from '../../../shared/ui/described-select';
import { HelpHint } from '../../../shared/ui/help-hint';
import { VariantThumbnail } from '../../products';
import {
  GiftDocumentPreview,
  GiftFormPickerValues,
  useDocumentProvidersQuery,
  useGiftDocumentSettingsQuery,
  useGiftFormLabels,
  zeroAvailability,
  type GiftDocumentFormChoice,
} from '../../gift-documents';
import { BUNDLE_GIFT_FORMS, type BundleFormRow } from '../lib/bundle-form-model';

function isForm(value: string): value is GiftDocumentFormChoice {
  return (GiftFormPickerValues as readonly string[]).includes(value);
}

export interface BundleStepGiftsProps {
  rows: readonly BundleFormRow[];
  readOnly: boolean;
  currency: string | undefined;
  onFormChange: (variantId: string, documentForm: string) => void;
  onBackToComponents: () => void;
}

export function BundleStepGifts({
  rows,
  readOnly,
  currency,
  onFormChange,
  onBackToComponents,
}: BundleStepGiftsProps): ReactElement {
  const copy = useMessages('bundles').form;
  const giftCopy = useMessages('gift-documents');
  const labels = useGiftFormLabels();
  const settings = useGiftDocumentSettingsQuery();
  const providers = useDocumentProvidersQuery();
  const zero = zeroAvailability(providers.data?.providers);
  const gifts = rows.filter((row) => row.gift);
  const inherited = settings.data?.giftDocumentForm ?? null;
  const inheritedBundleForm =
    inherited !== null && (BUNDLE_GIFT_FORMS as readonly string[]).includes(inherited)
      ? inherited
      : null;

  if (gifts.length === 0) {
    return (
      <div className="bf-step">
        <p className="bf-lead">{copy.s3Lead}</p>
        <div className="cx-empty" data-testid="bundle-form-no-gifts">
          <p className="pm-empty__d">{copy.s3None}</p>
          <Button tone="secondary" className="button--sm" onClick={onBackToComponents}>
            {copy.s3GoBack}
          </Button>
        </div>
      </div>
    );
  }

  const options: DescribedSelectOption<string>[] = [
    {
      value: 'inherit',
      title:
        inheritedBundleForm === null
          ? copy.s3InheritUnknown
          : interpolate(copy.s3Inherit, { form: labels.short(inheritedBundleForm as GiftDocumentFormChoice) }),
      description: copy.s3InheritText,
    },
    ...BUNDLE_GIFT_FORMS.map((form): DescribedSelectOption<string> => {
      const unavailable = form === 'show-zero' && !zero.available;
      return {
        value: form,
        title: giftCopy.cards.forms[form].title,
        description: giftCopy.cards.forms[form].description,
        disabled: unavailable,
        disabledReason: unavailable
          ? zero.refusingProviderName
            ? interpolate(giftCopy.connection.zeroNotOffered, { provider: zero.refusingProviderName })
            : giftCopy.connection.zeroNoProvider
          : undefined,
      };
    }),
  ];

  return (
    <div className="bf-step">
      <p className="bf-lead">
        {copy.s3Lead}
        <HelpHint guide="g-gift" label={copy.s1Help} />
      </p>
      <ul className="bf-gifts" data-testid="bundle-form-gift-list">
        {gifts.map((row) => {
          const value = isForm(row.documentForm) ? row.documentForm : 'inherit';
          const previewForm: GiftDocumentFormChoice | null =
            value === 'inherit' ? inherited : value;
          return (
            <li key={row.variantId} className="bf-gift">
              <div className="bf-gift__who">
                <VariantThumbnail src={row.imageUrl} name={row.name} size="md" />
                <span>
                  <span className="bf-comp__name">{row.name}</span>
                  {row.attributes ? <span className="bf-comp__attrs">{row.attributes}</span> : null}
                </span>
              </div>
              <div className="bf-gift__pick">
                <span className="form-field__label">{copy.s3Form}</span>
                <DescribedSelect<string>
                  options={options}
                  value={value}
                  onChange={(next) => {
                    onFormChange(row.variantId, next === 'inherit' ? '' : next);
                  }}
                  aria-label={`${copy.s3Form}: ${row.name}`}
                  disabled={readOnly}
                  data-testid={`bundle-form-gift-form-${row.sku ?? row.variantId}`}
                />
              </div>
              {previewForm !== null ? (
                <div className="bf-gift__preview">
                  <span className="pm-help">{copy.s3Preview}</span>
                  <GiftDocumentPreview
                    form={previewForm}
                    acceptsZeroValueLine={zero.available}
                    currency={currency ?? 'PLN'}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="pm-help">
        {giftCopy.perGift.label}: {copy.giftDecision}{' '}
        <Link to="/settings/sales-documents">{copy.giftSettingsLink}</Link>
      </p>
    </div>
  );
}
