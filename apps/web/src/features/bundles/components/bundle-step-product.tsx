/**
 * Bundle form, step 2: the bundle as a product (#3935)
 *
 * A bundle is sold as an ordinary product, so this step answers one question:
 * where does that product come from? It opens with a one-sentence model and a
 * three-node picture (components -> the bundle product in the shop -> offers),
 * because the question makes no sense until you know why a shop is involved.
 * "Create a new product" comes first and is the default, because a seller
 * building their first bundle has no such product yet; "I already have it" is
 * the second card. A shop that cannot create products is listed with its
 * reason, never hidden, and every failure names its recovery.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
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
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import { useBundleCreationTargetsQuery } from '../hooks/use-bundle-queries';
import { BundleVariantPicker } from './bundle-variant-picker';

/** "Zestaw: A + B": the name a seller would type anyway; empty until there are two components. */
export function suggestedBundleName(rows: readonly ParsedRow[], prefix: string): string {
  const names = rows.filter((row) => row.qty > 0).map((row) => row.name);
  if (names.length < 2) return '';
  const shown = names.slice(0, 3).join(' + ');
  return `${prefix}: ${shown}${names.length > 3 ? ' + ...' : ''}`;
}

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

function ModelDiagram({ highlight }: { highlight: BundleProductMode }): ReactElement {
  const copy = useMessages('bundles').form;
  return (
    <figure className="s2-model" data-testid="bundle-form-model" aria-label={copy.s2DiagramLabel}>
      <ol className="s2-model__row">
        <li className="s2-model__node">{copy.s2DiagramComponents}</li>
        <li className="s2-model__arrow" aria-hidden="true">
          <svg viewBox="0 0 24 12"><path d="M1 6h20m-5-5 5 5-5 5" /></svg>
        </li>
        <li className={`s2-model__node is-focus is-${highlight}`}>{copy.s2DiagramProduct}</li>
        <li className="s2-model__arrow" aria-hidden="true">
          <svg viewBox="0 0 24 12"><path d="M1 6h20m-5-5 5 5-5 5" /></svg>
        </li>
        <li className="s2-model__node">{copy.s2DiagramOffers}</li>
      </ol>
      <figcaption className="s2-model__cap">{copy.s2DiagramCaption}</figcaption>
    </figure>
  );
}

function Suggestion({
  active,
  restorable,
  onRestore,
}: {
  active: boolean;
  restorable: boolean;
  onRestore: () => void;
}): ReactElement | null {
  const copy = useMessages('bundles').form;
  if (active) return <span className="s2-chip" data-testid="bundle-form-hint-chip">{copy.s2Hint}</span>;
  if (restorable) {
    return (
      <button type="button" className="link s2-restore" onClick={onRestore}>
        {copy.s2RestoreHint}
      </button>
    );
  }
  return null;
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
  const apiClient = useApiClient();
  const targetsQuery = useBundleCreationTargetsQuery();
  const creators = (targets ?? []).filter((target) => target.creationMode !== null);
  const canCreate = creators.length > 0;
  const targetsLoaded = targets !== undefined;
  const noShops = targetsLoaded && targets.length === 0;
  const noCreators = targetsLoaded && targets.length > 0 && !canCreate;

  const sum = componentsSum(parsedRows);
  const effectivePrice = draft.touched.price ? draft.price : formatPriceInput(sum);
  const typedPrice = parsePrice(effectivePrice);
  const savings = sum !== null && typedPrice !== null && sum > typedPrice ? sum - typedPrice : null;
  const skuSuggestion = suggestedSku(parsedRows);
  const effectiveSku = draft.touched.sku ? draft.sku : skuSuggestion;
  const descriptionSuggestion = suggestedDescription(parsedRows);
  const effectiveDescription = draft.touched.description ? draft.description : descriptionSuggestion;
  const nameSuggestion = suggestedBundleName(parsedRows, copy.s2NamePrefix);

  // The first load decides the default: a shop that can create products makes
  // "create" the answer, because the person is building their first bundle.
  const defaulted = useRef(false);
  useEffect(() => {
    if (editing || defaulted.current || !targetsLoaded) return;
    defaulted.current = true;
    if (canCreate && bundleProduct === null && mode === 'existing' && !readOnly) {
      onModeChange('create');
    }
  }, [editing, targetsLoaded, canCreate, bundleProduct, mode, readOnly, onModeChange]);

  // The name follows the components until the operator types over it. "Untouched"
  // is "equal to the last suggestion", so clearing the field is a decision that
  // stays, not a prompt for the suggestion to come back.
  const lastNameSuggestion = useRef('');
  useEffect(() => {
    if (editing || mode !== 'create' || readOnly) return;
    if (nameSuggestion === lastNameSuggestion.current) return;
    if (draft.name === lastNameSuggestion.current) {
      onDraftChange({ name: nameSuggestion });
    }
    lastNameSuggestion.current = nameSuggestion;
  }, [editing, mode, readOnly, nameSuggestion, draft.name, onDraftChange]);

  const [moreOpen, setMoreOpen] = useState(draft.ean !== '' || draft.touched.description);

  // Whether the SKU is already a product in the catalogue: said while typing,
  // because the shop would adopt that product on save and quietly drop what was typed here.
  const skuProbe = useDebouncedValue(effectiveSku.trim(), 300);
  const skuQuery = useQuery({
    queryKey: ['bundles', 'sku-probe', skuProbe],
    queryFn: () => apiClient.products.listRows({ search: skuProbe }, { limit: 5, offset: 0 }),
    enabled: !editing && mode === 'create' && skuProbe.length >= 2,
    staleTime: 15_000,
  });
  const skuTaken =
    skuProbe === effectiveSku.trim()
      ? (skuQuery.data?.items ?? []).find(
          (product) => (product.sku ?? '').toLowerCase() === skuProbe.toLowerCase()
        )
      : undefined;
  const [adopting, setAdopting] = useState(false);
  const adoptExisting = async (): Promise<void> => {
    if (skuTaken === undefined) return;
    setAdopting(true);
    try {
      const detail = await apiClient.products.getById(skuTaken.id);
      const variants = detail.variants ?? [];
      const picked =
        variants.find((v) => (v.sku ?? '').toLowerCase() === skuProbe.toLowerCase()) ?? variants[0];
      onModeChange('existing');
      if (picked !== undefined) onPickProduct(toBundleChoice(detail, picked, variants.length));
    } finally {
      setAdopting(false);
    }
  };

  // A failed create is the one thing on this step the operator did not cause by
  // typing, so it is brought into view, and it goes away once they change something.
  const errorRef = useRef<HTMLDivElement | null>(null);
  const draftKey = `${draft.connectionId}|${draft.name}|${effectiveSku}|${effectivePrice}|${draft.ean}`;
  const [errorFor, setErrorFor] = useState<string | null>(null);
  // Read at the moment an error arrives: later draft edits must not re-arm it.
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  useEffect(() => {
    if (createError !== null) {
      setErrorFor(draftKeyRef.current);
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [createError]);
  const errorVisible = createError !== null && errorFor === draftKey;

  const productCard = (choice: BundleProductChoice, action: ReactElement | null): ReactElement => (
    <div className="pm-picker">
      <span className="pm-picker__f">
        <VariantThumbnail src={choice.imageUrl} name={choice.name} size="md" />
        <span>
          <span className="pm-picker__n" data-testid="bundle-form-name">
            {choice.name}
          </span>
          <br />
          <span className="pm-picker__s">
            <span data-testid="bundle-form-sku">{choice.sku ?? ''}</span>
            {choice.price !== null
              ? ` · ${copy.price.toLowerCase()} ${format.money(choice.price, currency)}`
              : ''}
          </span>
        </span>
        {action ?? <span />}
      </span>
    </div>
  );

  if (editing) {
    return (
      <div className="bf-step">
        <p className="bf-lead">{copy.s2Locked}</p>
        {bundleProduct !== null ? productCard(bundleProduct, null) : null}
        <p className="pm-help">{copy.s2ExistingHelp}</p>
      </div>
    );
  }

  const masterOptions: DescribedSelectOption<string>[] = (targets ?? []).map((target) => ({
    value: target.connectionId,
    title: target.connectionName,
    description: interpolate(copy.s2MasterSimple, { platform: target.platformType }),
    disabled: target.creationMode === null,
    disabledReason: copy.s2MasterCannot,
  }));
  const chosenMaster =
    draft.connectionId !== '' ? draft.connectionId : (creators[0]?.connectionId ?? '');
  const onlyCreator = creators.length === 1 ? creators[0] : undefined;

  const nameIsSuggestion = nameSuggestion !== '' && draft.name === nameSuggestion;
  const ean = draft.ean;

  return (
    <div className="bf-step s2">
      <p className="bf-lead">{copy.s2Lead}</p>
      <ModelDiagram highlight={mode} />
      <p className="pm-help s2-why">{copy.s2Why}</p>

      <RadioCardGroup<BundleProductMode>
        name="bundle-product-mode"
        value={mode}
        onChange={onModeChange}
        aria-label={copy.s2Mode}
        disabled={readOnly}
        options={[
          {
            value: 'create',
            title: (
              <>
                {copy.s2ModeNew}
                {canCreate ? <span className="s2-rec">{copy.s2Recommended}</span> : null}
              </>
            ),
            description: copy.s2ModeNewText,
            disabled: targetsLoaded && !canCreate,
            disabledReason: copy.s2ModeNewDisabled,
            'data-testid': 'bundle-form-mode-create',
          },
          {
            value: 'existing',
            title: copy.s2ModeExisting,
            description: copy.s2ModeExistingText,
            'data-testid': 'bundle-form-mode-existing',
          },
        ]}
      />

      {noShops ? (
        <Alert tone="info" data-testid="bundle-form-no-creators">
          {copy.s2NoShops}{' '}
          <Link to="/connections/new">{copy.s2NoShopsLink}</Link>
        </Alert>
      ) : null}
      {noCreators ? (
        <Alert tone="info" data-testid="bundle-form-no-creators">
          {copy.s2NoMasters}{' '}
          <Link to="/connections">{copy.s2ConnectionsLink}</Link>
        </Alert>
      ) : null}
      {targetsFailed ? (
        <Alert tone="warning" data-testid="bundle-form-targets-failed">
          <span>{copy.s2TargetsFailed}</span>{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              void targetsQuery.refetch();
            }}
          >
            {copy.s2Retry}
          </button>
        </Alert>
      ) : null}

      {mode === 'existing' ? (
        bundleProduct === null ? (
          <div className="bf-block s2-panel">
            <BundleVariantPicker
              label={copy.pickProduct}
              placeholder={copy.searchProduct}
              disabled={readOnly}
              excludeVariantIds={excludeVariantIds}
              disallowBundles
              onPick={onPickProduct}
              testIdPrefix="bundle-form-product-search"
            />
            {canCreate && !readOnly ? (
              <button
                type="button"
                className="link s2-switch"
                data-testid="bundle-form-switch-create"
                onClick={() => {
                  onModeChange('create');
                }}
              >
                {copy.s2SearchEmptyAction}
              </button>
            ) : null}
            {showErrors ? <p className="pm-err pm-err--on">{copy.noProductHint}</p> : null}
          </div>
        ) : (
          <div className="bf-block s2-panel">
            {productCard(
              bundleProduct,
              <Button tone="secondary" className="button--sm" disabled={readOnly} onClick={onClearProduct}>
                {copy.changeProduct}
              </Button>
            )}
            <p className="pm-help">{copy.s2ExistingHelp}</p>
          </div>
        )
      ) : (
        <div className="bf-block bf-newproduct s2-panel" data-testid="bundle-form-new-product">
          <Alert tone="info" data-testid="bundle-form-nothing-yet">
            {copy.s2NothingYet}
          </Alert>

          <div className="form-field s2-master">
            <span className="form-field__label bf-labelrow">
              {copy.s2Master}
              <HelpHint guide="g-new" label={copy.s2MasterHelp} />
            </span>
            {onlyCreator !== undefined ? (
              <p className="s2-master__static" data-testid="bundle-form-master">
                {interpolate(copy.s2MasterStatic, { name: onlyCreator.connectionName })}
              </p>
            ) : (
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
            )}
            <p className="pm-help">{copy.s2MasterHelp}</p>
          </div>

          <div className="s2-grid">
            <label className="form-field">
              <span className="form-field__label bf-labelrow">
                {copy.s2Name}
                <Suggestion
                  active={nameIsSuggestion}
                  restorable={nameSuggestion !== '' && draft.name !== nameSuggestion}
                  onRestore={() => {
                    onDraftChange({ name: nameSuggestion });
                  }}
                />
              </span>
              <Input
                value={draft.name}
                disabled={readOnly}
                invalid={showErrors && draft.name.trim() === ''}
                data-testid="bundle-form-new-name"
                onChange={(event) => {
                  onDraftChange({ name: event.target.value });
                }}
              />
              <span className="pm-help">{copy.s2NameHelp}</span>
            </label>
            <label className="form-field">
              <span className="form-field__label bf-labelrow">
                {copy.s2Sku}
                <Suggestion
                  active={!draft.touched.sku && skuSuggestion !== ''}
                  restorable={draft.touched.sku && skuSuggestion !== '' && draft.sku !== skuSuggestion}
                  onRestore={() => {
                    onDraftChange({ sku: '', touched: { ...draft.touched, sku: false } });
                  }}
                />
              </span>
              <Input
                className="mono"
                value={effectiveSku}
                disabled={readOnly}
                invalid={(showErrors && effectiveSku.trim() === '') || skuTaken !== undefined}
                data-testid="bundle-form-new-sku"
                onChange={(event) => {
                  onDraftChange({ sku: event.target.value, touched: { ...draft.touched, sku: true } });
                }}
              />
              <span className="pm-help">{copy.s2SkuHelp}</span>
            </label>
            <label className="form-field">
              <span className="form-field__label bf-labelrow">
                {copy.s2Price}
                <HelpHint guide="g-price" label={copy.s2PriceFixed} />
                <Suggestion
                  active={!draft.touched.price && sum !== null}
                  restorable={draft.touched.price && sum !== null && formatPriceInput(sum) !== draft.price}
                  onRestore={() => {
                    onDraftChange({ price: formatPriceInput(sum), touched: { ...draft.touched, price: false } });
                  }}
                />
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
              <span className="pm-help">{copy.s2PriceSuggestHelp}</span>
            </label>
            <div className="form-field s2-pricenote" aria-live="polite">
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
                  <span className="pm-help">{copy.s2PriceFixed}</span>
                </>
              )}
            </div>
          </div>

          {skuTaken !== undefined ? (
            <Alert tone="warning" data-testid="bundle-form-sku-taken">
              <span>{interpolate(copy.s2SkuTaken, { sku: skuProbe, name: skuTaken.name })}</span>{' '}
              <button
                type="button"
                className="link"
                disabled={adopting || readOnly}
                onClick={() => {
                  void adoptExisting();
                }}
              >
                {copy.s2UseExisting}
              </button>
            </Alert>
          ) : null}

          <details
            className="s2-more"
            open={moreOpen}
            onToggle={(event) => {
              setMoreOpen(event.currentTarget.open);
            }}
          >
            <summary>{copy.s2More}</summary>
            <div className="s2-more__body">
              <label className="form-field">
                <span className="form-field__label">{copy.s2Ean}</span>
                <Input
                  className="mono"
                  inputMode="numeric"
                  value={ean}
                  disabled={readOnly}
                  data-testid="bundle-form-new-ean"
                  onChange={(event) => {
                    onDraftChange({ ean: event.target.value });
                  }}
                />
                <span className="pm-help">{copy.s2EanHelp}</span>
              </label>
              <label className="form-field">
                <span className="form-field__label bf-labelrow">
                  {copy.s2Description}
                  <Suggestion
                    active={!draft.touched.description && descriptionSuggestion !== ''}
                    restorable={
                      draft.touched.description &&
                      descriptionSuggestion !== '' &&
                      draft.description !== descriptionSuggestion
                    }
                    onRestore={() => {
                      onDraftChange({
                        description: '',
                        touched: { ...draft.touched, description: false },
                      });
                    }}
                  />
                </span>
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
            </div>
          </details>

          {errorVisible ? (
            <div ref={errorRef} tabIndex={-1} className="s2-error">
              <Alert tone="error" title={copy.s2CreateErrorTitle} data-testid="bundle-form-create-error">
                {createError}
              </Alert>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
