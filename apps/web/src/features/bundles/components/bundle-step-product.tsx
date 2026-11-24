/**
 * Bundle form, step 2: the bundle as a product (#3935)
 *
 * A bundle is sold as an ordinary product, so this step answers one question:
 * where does that product come from? Either the shop already has it (pick it;
 * its name, SKU and price stay the shop's), or OpenLinker creates it in a shop
 * that allows that. The create path says what each shop will do BEFORE the form
 * is filled in, and a shop that cannot create products is listed with its
 * reason, never hidden.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { DescribedSelect, type DescribedSelectOption } from '../../../shared/ui/described-select';
import { HelpHint } from '../../../shared/ui/help-hint';
import { Input } from '../../../shared/ui/input';
import { RadioCardGroup } from '../../../shared/ui/radio-card-group';
import { VariantThumbnail } from '../../products';
import type { BundleCreationTarget } from '../api/bundles.types';
import {
  componentsSum,
  formatPriceInput,
  parsePrice,
  suggestedDescription,
  suggestedSku,
  type BundleProductMode,
  type NewProductDraft,
  type ParsedRow,
} from '../lib/bundle-form-model';
import type { BundleProductChoice } from '../lib/bundle-choice';
import { BundleVariantPicker } from './bundle-variant-picker';

export interface BundleStepProductProps {
  editing: boolean;
  readOnly: boolean;
  mode: BundleProductMode;
  onModeChange: (mode: BundleProductMode) => void;
  targets: readonly BundleCreationTarget[] | undefined;
  targetsFailed: boolean;
  draft: NewProductDraft;
  onDraftChange: (patch: Partial<NewProductDraft>) => void;
  parsedRows: ParsedRow[];
  currency: string | undefined;
  bundleProduct: BundleProductChoice | null;
  onPickProduct: (choice: BundleProductChoice) => void;
  onClearProduct: () => void;
  excludeVariantIds: readonly string[];
  showErrors: boolean;
  createError: string | null;
}

export function BundleStepProduct({
  editing,
  readOnly,
  mode,
  onModeChange,
  targets,
  targetsFailed,
  draft,
  onDraftChange,
  parsedRows,
  currency,
  bundleProduct,
  onPickProduct,
  onClearProduct,
  excludeVariantIds,
  showErrors,
  createError,
}: BundleStepProductProps): ReactElement {
  const copy = useMessages('bundles').form;
  const format = useFormat();
  const creators = (targets ?? []).filter((target) => target.creationMode !== null);
  const canCreate = creators.length > 0;

  const sum = componentsSum(parsedRows);
  const effectivePrice = draft.touched.price ? draft.price : formatPriceInput(sum);
  const typedPrice = parsePrice(effectivePrice);
  const savings = sum !== null && typedPrice !== null && sum > typedPrice ? sum - typedPrice : null;
  const effectiveSku = draft.touched.sku ? draft.sku : suggestedSku(parsedRows);
  const effectiveDescription = draft.touched.description
    ? draft.description
    : suggestedDescription(parsedRows);

  if (editing) {
    return (
      <div className="bf-step">
        <p className="bf-lead">{copy.s2Locked}</p>
        {bundleProduct !== null ? (
          <div className="pm-picker">
            <span className="pm-picker__f">
              <VariantThumbnail src={bundleProduct.imageUrl} name={bundleProduct.name} size="md" />
              <span>
                <span className="pm-picker__n" data-testid="bundle-form-name">
                  {bundleProduct.name}
                </span>
                <br />
                <span className="pm-picker__s">
                  <span data-testid="bundle-form-sku">{bundleProduct.sku ?? ''}</span>
                  {bundleProduct.price !== null
                    ? ` · ${copy.price.toLowerCase()} ${format.money(bundleProduct.price, currency)}`
                    : ''}
                </span>
              </span>
              <span />
            </span>
          </div>
        ) : null}
        <p className="pm-help">{copy.s2ExistingHelp}</p>
      </div>
    );
  }

  const masterOptions: DescribedSelectOption<string>[] = (targets ?? []).map((target) => ({
    value: target.connectionId,
    title: target.connectionName,
    description: copy.s2MasterSimple,
    disabled: target.creationMode === null,
    disabledReason: copy.s2MasterCannot,
  }));
  const chosenMaster =
    draft.connectionId !== '' ? draft.connectionId : (creators[0]?.connectionId ?? '');

  return (
    <div className="bf-step">
      <p className="bf-lead">{copy.s2Lead}</p>
      <RadioCardGroup<BundleProductMode>
        name="bundle-product-mode"
        value={mode}
        onChange={onModeChange}
        aria-label={copy.s2Mode}
        disabled={readOnly}
        options={[
          {
            value: 'existing',
            title: copy.s2ModeExisting,
            description: copy.s2ModeExistingText,
            'data-testid': 'bundle-form-mode-existing',
          },
          {
            value: 'create',
            title: copy.s2ModeNew,
            description: copy.s2ModeNewText,
            disabled: !canCreate,
            disabledReason: copy.s2ModeNewDisabled,
            'data-testid': 'bundle-form-mode-create',
          },
        ]}
      />
      {!canCreate && targets !== undefined ? (
        <Alert tone="info" data-testid="bundle-form-no-creators">
          {copy.s2NoMasters}
        </Alert>
      ) : null}
      {targetsFailed ? <Alert tone="warning">{copy.s2NoMasters}</Alert> : null}

      {mode === 'existing' ? (
        bundleProduct === null ? (
          <div className="bf-block">
            <BundleVariantPicker
              label={copy.pickProduct}
              placeholder={copy.searchProduct}
              disabled={readOnly}
              excludeVariantIds={excludeVariantIds}
              onPick={onPickProduct}
              testIdPrefix="bundle-form-product-search"
            />
            {showErrors ? <p className="pm-err pm-err--on">{copy.noProductHint}</p> : null}
          </div>
        ) : (
          <div className="bf-block">
            <div className="pm-picker">
              <span className="pm-picker__f">
                <VariantThumbnail src={bundleProduct.imageUrl} name={bundleProduct.name} size="md" />
                <span>
                  <span className="pm-picker__n" data-testid="bundle-form-name">
                    {bundleProduct.name}
                  </span>
                  <br />
                  <span className="pm-picker__s">
                    <span data-testid="bundle-form-sku">{bundleProduct.sku ?? ''}</span>
                    {bundleProduct.price !== null
                      ? ` · ${copy.price.toLowerCase()} ${format.money(bundleProduct.price, currency)}`
                      : ''}
                  </span>
                </span>
                <Button tone="secondary" className="button--sm" disabled={readOnly} onClick={onClearProduct}>
                  {copy.changeProduct}
                </Button>
              </span>
            </div>
            <p className="pm-help">{copy.s2ExistingHelp}</p>
          </div>
        )
      ) : (
        <div className="bf-block bf-newproduct" data-testid="bundle-form-new-product">
          <div className="form-field">
            <span className="form-field__label bf-labelrow">
              {copy.s2Master}
              <HelpHint guide="g-new" label={copy.s2MasterHelp} />
            </span>
            <DescribedSelect<string>
              options={masterOptions}
              value={chosenMaster}
              onChange={(value) => {
                onDraftChange({ connectionId: value });
              }}
              aria-label={copy.s2Master}
              disabled={readOnly}
              data-testid="bundle-form-master"
            />
            <p className="pm-help">{copy.s2MasterHelp}</p>
          </div>
          <div className="pm-row2">
            <label className="form-field">
              <span className="form-field__label">{copy.s2Name}</span>
              <Input
                value={draft.name}
                disabled={readOnly}
                invalid={showErrors && draft.name.trim() === ''}
                data-testid="bundle-form-new-name"
                onChange={(event) => {
                  onDraftChange({ name: event.target.value });
                }}
              />
            </label>
            <label className="form-field">
              <span className="form-field__label">{copy.s2Sku}</span>
              <Input
                className="mono"
                value={effectiveSku}
                disabled={readOnly}
                invalid={showErrors && effectiveSku.trim() === ''}
                data-testid="bundle-form-new-sku"
                onChange={(event) => {
                  onDraftChange({ sku: event.target.value, touched: { ...draft.touched, sku: true } });
                }}
              />
              <span className="pm-help">{copy.s2SkuHelp}</span>
            </label>
          </div>
          <div className="pm-row2">
            <label className="form-field">
              <span className="form-field__label bf-labelrow">
                {copy.s2Price}
                <HelpHint guide="g-price" label={copy.s2PriceFixed} />
              </span>
              <span className="pm-money">
                <Input
                  className="mono tabular"
                  inputMode="decimal"
                  value={effectivePrice}
                  disabled={readOnly}
                  invalid={showErrors && typedPrice === null}
                  data-testid="bundle-form-new-price"
                  onChange={(event) => {
                    onDraftChange({
                      price: event.target.value,
                      touched: { ...draft.touched, price: true },
                    });
                  }}
                />
                <span>{currency === undefined || currency === 'PLN' ? 'zł' : currency}</span>
              </span>
              <span className="pm-help">{copy.s2PriceFixed}</span>
            </label>
            <div className="form-field bf-pricenote" aria-live="polite">
              {sum === null ? (
                <span className="pm-help">{copy.s2PriceNoSum}</span>
              ) : (
                <>
                  <span className="pm-help">
                    {interpolate(copy.s2PriceSum, { sum: format.money(sum, currency) })}
                  </span>
                  {savings !== null ? (
                    <b className="bf-saves" data-testid="bundle-form-saves">
                      {interpolate(copy.s2PriceSaves, { amount: format.money(savings, currency) })}
                    </b>
                  ) : null}
                  {draft.touched.price && formatPriceInput(sum) !== draft.price ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        onDraftChange({ price: formatPriceInput(sum), touched: { ...draft.touched, price: false } });
                      }}
                    >
                      {copy.s2PriceUseSum}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <label className="form-field">
            <span className="form-field__label">{copy.s2Ean}</span>
            <Input
              className="mono"
              inputMode="numeric"
              value={draft.ean}
              disabled={readOnly}
              data-testid="bundle-form-new-ean"
              onChange={(event) => {
                onDraftChange({ ean: event.target.value });
              }}
            />
            <span className="pm-help">{copy.s2EanHelp}</span>
          </label>
          <label className="form-field">
            <span className="form-field__label">{copy.s2Description}</span>
            <textarea
              className="control bf-textarea"
              rows={3}
              value={effectiveDescription}
              disabled={readOnly}
              data-testid="bundle-form-new-description"
              onChange={(event) => {
                onDraftChange({
                  description: event.target.value,
                  touched: { ...draft.touched, description: true },
                });
              }}
            />
            <span className="pm-help">{copy.s2DescriptionHelp}</span>
          </label>
          <p className="pm-help">{copy.s2Images}</p>
          {createError !== null ? (
            <Alert tone="error" data-testid="bundle-form-create-error">
              {createError}
            </Alert>
          ) : null}
        </div>
      )}
    </div>
  );
}
