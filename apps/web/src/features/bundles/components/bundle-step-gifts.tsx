/**
 * Bundle form, step 3: gifts and documents (#3935)
 *
 * Two things, in the order a seller worries about them. First, what a gift in a
 * bundle means in three plain lines (it ships in the price, it comes off stock
 * and counts to cost, the document form changes only how it reads). Second, how
 * the bundle itself lands on a sales document, always shown with a small
 * preview, because that is the question even a bundle without gifts raises.
 * Each gift then shows its default document form as text; another form is one
 * click away ("Inna forma"), not a dropdown that has to be understood first.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
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
import { splitBundlePrice } from '../lib/bundle-price-split';

function isForm(value: string): value is GiftDocumentFormChoice {
  return (GiftFormPickerValues as readonly string[]).includes(value);
}

export interface BundleStepGiftsProps {
  rows: readonly BundleFormRow[];
  readOnly: boolean;
  currency: string | undefined;
  onFormChange: (variantId: string, documentForm: string) => void;
  onBackToComponents: () => void;
  /** The bundle's name and price, when the form knows them: they make the document preview concrete. */
  bundleName?: string | null;
  bundlePrice?: number | null;
}

/** "Jak zestaw wygląda na dokumencie": one line, or the components, or held; always visible. */
function DocumentCard({
  rows,
  currency,
  bundleName,
  bundlePrice,
  giftFormLabel,
}: {
  rows: readonly BundleFormRow[];
  currency: string | undefined;
  bundleName: string | null;
  bundlePrice: number | null;
  giftFormLabel: string | null;
}): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const name = bundleName !== null && bundleName !== '' ? bundleName : copy.readbackNoProduct;
  const money = (amount: number): string => format.money(amount, currency);
  const split = splitBundlePrice(
    bundlePrice,
    rows.map((row) => ({
      variantId: row.variantId,
      quantity: Math.max(Number(row.quantity) || 1, 1),
      standalonePrice: row.price,
      giftSlot: row.gift,
    }))
  );
  const amountFor = (variantId: string): string | null => {
    if (split.kind !== 'ok') return null;
    const line = split.lines.find((l) => l.variantId === variantId);
    return line === undefined ? null : money(line.amount);
  };

  return (
    <section className="s3-doc" data-testid="bundle-form-doc-card" aria-labelledby="s3-doc-h">
      <h3 id="s3-doc-h" className="bf-h3">
        {copy.s3DocTitle}
      </h3>
      <p className="pm-help">{copy.s3DocText}</p>
      <div className="s3-doc__minis">
        <div className="s3-doc__mini">
          <span className="s3-doc__cap">{copy.s3DocSame}</span>
          <div className="pm-doc" data-testid="bundle-form-doc-same">
            <span className="pm-doc__l">
              <span>{name}</span>
              <b className="mono tabular">{bundlePrice !== null ? money(bundlePrice) : ''}</b>
            </span>
          </div>
        </div>
        <div className="s3-doc__mini">
          <span className="s3-doc__cap">{copy.s3DocDiffer}</span>
          <div className="pm-doc" data-testid="bundle-form-doc-differ">
            {rows.map((row) => (
              <span key={row.variantId} className={`pm-doc__l${row.gift ? ' is-gift' : ''}`}>
                <span>{row.name}</span>
                <b className="mono tabular">{amountFor(row.variantId) ?? ''}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="pm-help s3-doc__held">{copy.s3DocHeld}</p>
      {giftFormLabel !== null ? (
        <p className="pm-help">{interpolate(copy.s3DocGiftNote, { form: giftFormLabel })}</p>
      ) : null}
    </section>
  );
}

export function BundleStepGifts({
  rows,
  readOnly,
  currency,
  onFormChange,
  onBackToComponents,
  bundleName = null,
  bundlePrice = null,
}: BundleStepGiftsProps): ReactElement {
  const copy = useMessages('bundles').form;
  const giftCopy = useMessages('gift-documents');
  const format = useFormat();
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
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const inheritLabel =
    inheritedBundleForm === null
      ? copy.s3InheritUnknown
      : labels.short(inheritedBundleForm as GiftDocumentFormChoice);

  const options: DescribedSelectOption<string>[] = [
    {
      value: 'inherit',
      title:
        inheritedBundleForm === null
          ? copy.s3InheritUnknown
          : interpolate(copy.s3Inherit, { form: inheritLabel }),
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

  const firstGiftForm = gifts[0];
  const docGiftLabel =
    firstGiftForm === undefined
      ? null
      : isForm(firstGiftForm.documentForm)
        ? labels.short(firstGiftForm.documentForm)
        : inheritLabel;

  return (
    <div className="bf-step s3">
      <div className="s3-rules">
        <p className="bf-lead">
          {copy.s3Lead}
          <HelpHint guide="g-gift" label={copy.s1Help} />
        </p>
        <ul className="s3-rules__list" data-testid="bundle-form-gift-rules">
          <li>{copy.s3Rule1}</li>
          <li>{copy.s3Rule2}</li>
          <li>{copy.s3Rule3}</li>
        </ul>
      </div>

      <DocumentCard
        rows={rows}
        currency={currency}
        bundleName={bundleName}
        bundlePrice={bundlePrice}
        giftFormLabel={docGiftLabel}
      />

      {gifts.length === 0 ? (
        <div className="cx-empty" data-testid="bundle-form-no-gifts">
          <p className="pm-empty__d">{copy.s3None}</p>
          <Button tone="secondary" className="button--sm" onClick={onBackToComponents}>
            {copy.s3GoBack}
          </Button>
        </div>
      ) : (
        <ul className="bf-gifts" data-testid="bundle-form-gift-list">
          {gifts.map((row) => {
            const value = isForm(row.documentForm) ? row.documentForm : 'inherit';
            const previewForm: GiftDocumentFormChoice | null =
              value === 'inherit' ? inherited : value;
            const open = value !== 'inherit' || revealed.has(row.variantId);
            const stock =
              row.availableToPromise === null
                ? copy.s3StockUnknown
                : interpolate(copy.pcs, { n: row.availableToPromise });
            const price = row.price === null ? copy.s3PriceUnknown : format.money(row.price, currency);
            return (
              <li key={row.variantId} className="bf-gift">
                <div className="bf-gift__who">
                  <VariantThumbnail src={row.imageUrl} name={row.name} size="md" />
                  <span>
                    <span className="bf-comp__name">{row.name}</span>
                    {row.attributes ? <span className="bf-comp__attrs">{row.attributes}</span> : null}
                    <span className="bf-comp__attrs" data-testid={`bundle-form-gift-meta-${row.sku ?? row.variantId}`}>
                      {interpolate(copy.s3GiftLine, { stock, price })}
                    </span>
                  </span>
                </div>
                <div className="bf-gift__pick">
                  <span className="form-field__label">{copy.s3Form}</span>
                  {open ? (
                    <>
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
                      {value !== 'inherit' ? (
                        <button
                          type="button"
                          className="link s3-reset"
                          disabled={readOnly}
                          onClick={() => {
                            onFormChange(row.variantId, '');
                          }}
                        >
                          {copy.s3KeepDefault}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p className="s3-default" data-testid={`bundle-form-gift-default-${row.sku ?? row.variantId}`}>
                      <span>{interpolate(copy.s3DefaultForm, { form: inheritLabel })}</span>
                      <button
                        type="button"
                        className="link"
                        disabled={readOnly}
                        data-testid={`bundle-form-gift-other-${row.sku ?? row.variantId}`}
                        onClick={() => {
                          setRevealed((current) => new Set(current).add(row.variantId));
                        }}
                      >
                        {copy.s3OtherForm}
                      </button>
                    </p>
                  )}
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
      )}
      <p className="pm-help">
        {copy.giftDecision} <Link to="/settings/sales-documents">{copy.giftSettingsLink}</Link>
      </p>
    </div>
  );
}
