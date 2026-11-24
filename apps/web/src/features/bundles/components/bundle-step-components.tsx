/**
 * Bundle form, step 1: what is in the bundle (#3935)
 *
 * Search with pictures, then one row per component: picture, name and
 * attributes, SKU and EAN, stock, how many bundles that stock allows, the
 * quantity in one bundle, and a visible Gift switch. The switch sits on the row
 * and never opens anything, so marking a gift cannot move the page; the gift's
 * form on the document is the next step's question.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import type { FieldArrayWithId, UseFieldArrayReturn, UseFormReturn } from 'react-hook-form';
import { formatPlural, interpolate, useLocale, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { HelpHint } from '../../../shared/ui/help-hint';
import { Input } from '../../../shared/ui/input';
import { VariantThumbnail } from '../../products';
import type { BundleFormValues, ParsedRow } from '../lib/bundle-form-model';
import type { BundleProductChoice } from '../lib/bundle-choice';
import { BundleVariantPicker } from './bundle-variant-picker';

export interface BundleStepComponentsProps {
  form: UseFormReturn<BundleFormValues>;
  components: UseFieldArrayReturn<BundleFormValues, 'components'>;
  rows: BundleFormValues['components'];
  parsedRows: ParsedRow[];
  readOnly: boolean;
  limitedName: string | null;
  showErrors: boolean;
  onAdd: (choice: BundleProductChoice) => void;
}

export function BundleStepComponents({
  form,
  components,
  rows,
  parsedRows,
  readOnly,
  limitedName,
  showErrors,
  onAdd,
}: BundleStepComponentsProps): ReactElement {
  const copy = useMessages('bundles').form;
  const { locale } = useLocale();

  return (
    <div className="bf-step">
      <p className="bf-lead">{copy.s1Lead}</p>
      <div className="form-field pm-combo">
        <BundleVariantPicker
          label={copy.addComponent}
          placeholder={copy.searchComponent}
          disabled={readOnly}
          excludeVariantIds={rows.map((row) => row.variantId)}
          onPick={onAdd}
          testIdPrefix="bundle-form-component-search"
        />
      </div>
      <div className="bf-listhead">
        <h3 className="bf-h3">
          {formatPlural(rows.length, copy.componentsCount, locale)}
        </h3>
        <span className="bf-listhead__help">
          {copy.s1GiftHelp}
          <HelpHint guide="g-gift" label={copy.s1Help} />
        </span>
      </div>

      <ul className="cx-rows" data-testid="bundle-form-components">
        {components.fields.map((field: FieldArrayWithId<BundleFormValues, 'components'>, index) => {
          const row = rows[index];
          const parsed = parsedRows[index];
          if (row === undefined || parsed === undefined) return null;
          const key = row.sku ?? row.variantId;
          const invalidQuantity = form.formState.errors.components?.[index]?.quantity !== undefined;
          const isLimiting = limitedName !== null && row.name === limitedName;
          const sets =
            parsed.qty > 0 && row.availableToPromise !== null
              ? Math.floor(row.availableToPromise / parsed.qty)
              : null;
          return (
            <li
              key={field.id}
              className={`cx-row bf-comp${row.gift ? ' is-gift' : ''}${isLimiting ? ' is-lim' : ''}${
                invalidQuantity ? ' is-invalid' : ''
              }`}
              data-testid={`bundle-form-component-row-${key}`}
            >
              <div className="bf-comp__grid">
                <span className="cx-ord">
                  <button
                    type="button"
                    className="pm-mv"
                    disabled={readOnly || index === 0}
                    aria-label={interpolate(copy.moveUp, { name: row.name })}
                    onClick={() => {
                      components.move(index, index - 1);
                    }}
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 7.5 6 4l3.5 3.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="pm-mv"
                    disabled={readOnly || index === components.fields.length - 1}
                    aria-label={interpolate(copy.moveDown, { name: row.name })}
                    onClick={() => {
                      components.move(index, index + 1);
                    }}
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 4.5 6 8l3.5-3.5" />
                    </svg>
                  </button>
                </span>
                <VariantThumbnail src={row.imageUrl} name={row.name} size="md" />
                <span className="bf-comp__main">
                  <span className="bf-comp__name">{row.name}</span>
                  {row.attributes ? <span className="bf-comp__attrs">{row.attributes}</span> : null}
                  <span className="bf-comp__codes mono" data-testid={`bundle-form-component-sku-${key}`}>
                    {row.sku ?? ''}
                    {row.ean ? ` · EAN ${row.ean}` : ''}
                  </span>
                  <span className="bf-comp__stock">
                    {row.availableToPromise === null ? (
                      copy.stockUnknown
                    ) : (
                      <>
                        <b>{interpolate(copy.pcs, { n: row.availableToPromise })}</b>
                        {sets !== null ? <> · {interpolate(copy.enoughFor, { n: sets })}</> : null}
                      </>
                    )}
                    {isLimiting ? (
                      <>
                        {' · '}
                        <b>{copy.limits}</b>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="cx-qty">
                  <span>×</span>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    aria-label={interpolate(copy.componentQuantity, { name: row.name })}
                    data-testid={`bundle-form-component-qty-${key}`}
                    disabled={readOnly}
                    invalid={invalidQuantity}
                    {...form.register(`components.${index}.quantity`)}
                  />
                </span>
                <span className="bf-comp__tools">
                  <label className="ol-toggle bf-giftswitch">
                    <input
                      type="checkbox"
                      checked={row.gift}
                      disabled={readOnly}
                      data-testid={`bundle-form-component-toggle-gift-${key}`}
                      aria-label={interpolate(copy.markGiftFor, { name: row.name })}
                      onChange={(event) => {
                        form.setValue(`components.${index}.gift`, event.target.checked, {
                          shouldDirty: true,
                        });
                      }}
                    />
                    <span>{copy.giftToggle}</span>
                  </label>
                  <Button
                    tone="ghost"
                    className="button--sm"
                    disabled={readOnly}
                    title={readOnly ? copy.viewOnlyReason : undefined}
                    aria-label={interpolate(copy.removeFor, { name: row.name })}
                    data-testid={`bundle-form-component-remove-${key}`}
                    onClick={() => {
                      components.remove(index);
                    }}
                  >
                    {copy.remove}
                  </Button>
                </span>
              </div>
              {row.gift ? <span hidden data-testid={`bundle-form-component-gift-${key}`} /> : null}
              <p className="pm-err">{copy.quantityInvalid}</p>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 ? (
        <div className="cx-empty">
          <p className="pm-empty__t">{copy.emptyTitle}</p>
          <p className="pm-empty__d">{copy.emptyComponents}</p>
        </div>
      ) : null}
      {showErrors && rows.length === 0 ? (
        <p className="pm-err" style={{ display: 'block' }}>
          {copy.emptyComponents}
        </p>
      ) : null}
      {form.formState.errors.components !== undefined && rows.length > 0 ? (
        <p className="form-field__error" role="alert">
          {copy.quantityInvalid}
        </p>
      ) : null}
    </div>
  );
}
