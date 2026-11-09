/**
 * Shop Attribute Picker (#1835)
 *
 * Structured attribute picker for a *shop* publish target (WooCommerce today).
 * Two modes toggled by a segmented control:
 *
 * - **Global attribute** — choose one of the store's store-wide global
 *   attributes (`ShopAttributeReader`, `pa_*` taxonomies), then tick from its
 *   predefined terms. On add, emits a neutral `OfferParameter` whose `id` is the
 *   global-attribute id, `values` are the chosen term names, and `valuesIds` are
 *   the chosen term ids — the linkage the WooCommerce adapter turns into a real
 *   global-attribute assignment (which powers storefront filtering).
 * - **Custom** — the fallback for one-off attributes: a free-text name + comma
 *   separated values, emitted as an `OfferParameter` with no `valuesIds`.
 *
 * Self-contained: consumes only the two shop-attribute query hooks + shared UI
 * primitives, and reports each chosen attribute via `onAdd`. Intended to be
 * mounted by the shop edit modal (#1830) in its attributes section, gated on the
 * connection's `ShopAttributeReader` capability. It does not own the list of
 * added attributes — the caller collects them and threads them onto the publish
 * `parameters`.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, Input, SegmentedControl, Select } from '../../../../shared/ui';
import { ErrorState, LoadingState } from '../../../../shared/ui/feedback-state';
import { useShopAttributesQuery } from '../../hooks/use-shop-attributes-query';
import { useShopAttributeTermsQuery } from '../../hooks/use-shop-attribute-terms-query';
import type { OfferParameter } from '../../api/listings.types';
import { useMessages } from '../../../../shared/i18n';

type PickerMode = 'global' | 'custom';

interface ShopAttributePickerProps {
  connectionId: string;
  /** Fires with a neutral product-section parameter for each attribute added. */
  onAdd: (parameter: OfferParameter) => void;
  disabled?: boolean;
}

export function ShopAttributePicker({
  connectionId,
  onAdd,
  disabled = false,
}: ShopAttributePickerProps): ReactElement {
  const copy = useMessages('listings').shopAttributePicker;
  const [mode, setMode] = useState<PickerMode>('global');
  const modeOptions = useMemo(
    () => [
      { value: 'global' as const, label: copy.modes.global },
      { value: 'custom' as const, label: copy.modes.custom },
    ],
    [copy],
  );

  return (
    <div className="shop-attr-picker">
      <SegmentedControl
        options={modeOptions}
        value={mode}
        onChange={setMode}
        aria-label={copy.modes.label}
      />
      {mode === 'global' ? (
        <GlobalAttributePanel connectionId={connectionId} onAdd={onAdd} disabled={disabled} />
      ) : (
        <CustomAttributePanel onAdd={onAdd} disabled={disabled} />
      )}
    </div>
  );
}

function GlobalAttributePanel({
  connectionId,
  onAdd,
  disabled,
}: {
  connectionId: string;
  onAdd: (parameter: OfferParameter) => void;
  disabled: boolean;
}): ReactElement {
  const copy = useMessages('listings').shopAttributePicker;
  const [attributeId, setAttributeId] = useState<string>('');
  const [checkedTermIds, setCheckedTermIds] = useState<Record<string, boolean>>({});

  const attributesQuery = useShopAttributesQuery(connectionId);
  const termsQuery = useShopAttributeTermsQuery(connectionId, attributeId || null);

  const attributes = attributesQuery.data ?? [];
  const terms = termsQuery.data ?? [];
  const selectedAttribute = useMemo(
    () => attributes.find((a) => a.id === attributeId) ?? null,
    [attributes, attributeId],
  );

  function toggleTerm(termId: string): void {
    setCheckedTermIds((prev) => ({ ...prev, [termId]: !prev[termId] }));
  }

  function selectAttribute(nextId: string): void {
    setAttributeId(nextId);
    setCheckedTermIds({});
  }

  const chosenTerms = terms.filter((t) => checkedTermIds[t.id]);

  function add(): void {
    if (!selectedAttribute || chosenTerms.length === 0) return;
    onAdd({
      id: selectedAttribute.id,
      values: chosenTerms.map((t) => t.name),
      valuesIds: chosenTerms.map((t) => t.id),
      section: 'product',
    });
    setCheckedTermIds({});
  }

  if (attributesQuery.isLoading) {
    return (
      <LoadingState
        liveRegion="off"
        title={copy.attributes.loading.title}
        message={copy.attributes.loading.message}
      />
    );
  }
  if (attributesQuery.error) {
    return (
      <ErrorState
        title={copy.attributes.error.title}
        message={attributesQuery.error.message}
        action={<Button onClick={() => void attributesQuery.refetch()}>{copy.retry}</Button>}
      />
    );
  }
  if (attributes.length === 0) {
    return (
      <div className="shop-attr-picker__empty">
        {copy.attributes.empty}
      </div>
    );
  }

  return (
    <div className="shop-attr-picker__panel">
      <label className="shop-attr-picker__label" htmlFor="shop-attr-select">
        {copy.attributes.label}
      </label>
      <Select
        id="shop-attr-select"
        value={attributeId}
        disabled={disabled}
        onChange={(e) => selectAttribute(e.target.value)}
      >
        <option value="">{copy.attributes.placeholder}</option>
        {attributes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      {attributeId ? (
        termsQuery.isLoading ? (
          <LoadingState
            liveRegion="off"
            title={copy.terms.loading.title}
            message={copy.terms.loading.message}
          />
        ) : termsQuery.error ? (
          <ErrorState
            title={copy.terms.error.title}
            message={termsQuery.error.message}
            action={<Button onClick={() => void termsQuery.refetch()}>{copy.retry}</Button>}
          />
        ) : terms.length === 0 ? (
          <div className="shop-attr-picker__empty">{copy.terms.empty}</div>
        ) : (
          <fieldset className="shop-attr-picker__terms">
            <legend className="shop-attr-picker__label">{copy.terms.legend}</legend>
            {terms.map((t) => (
              <label key={t.id} className="shop-attr-picker__term">
                <input
                  type="checkbox"
                  checked={Boolean(checkedTermIds[t.id])}
                  disabled={disabled}
                  onChange={() => toggleTerm(t.id)}
                />
                <span>{t.name}</span>
              </label>
            ))}
          </fieldset>
        )
      ) : null}

      <div className="shop-attr-picker__foot">
        <Button
          tone="primary"
          type="button"
          disabled={disabled || chosenTerms.length === 0}
          onClick={add}
        >
          {copy.add}
        </Button>
      </div>
    </div>
  );
}

function CustomAttributePanel({
  onAdd,
  disabled,
}: {
  onAdd: (parameter: OfferParameter) => void;
  disabled: boolean;
}): ReactElement {
  const copy = useMessages('listings').shopAttributePicker;
  const [name, setName] = useState('');
  const [valuesText, setValuesText] = useState('');

  const values = useMemo(
    () =>
      valuesText
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    [valuesText],
  );
  const canAdd = name.trim() !== '' && values.length > 0;

  function add(): void {
    if (!canAdd) return;
    onAdd({ id: name.trim(), values, section: 'product' });
    setName('');
    setValuesText('');
  }

  return (
    <div className="shop-attr-picker__panel">
      <label className="shop-attr-picker__label" htmlFor="shop-attr-custom-name">
        {copy.custom.nameLabel}
      </label>
      <Input
        id="shop-attr-custom-name"
        value={name}
        disabled={disabled}
        placeholder={copy.custom.namePlaceholder}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="shop-attr-picker__label" htmlFor="shop-attr-custom-values">
        {copy.custom.valuesLabel}
      </label>
      <Input
        id="shop-attr-custom-values"
        value={valuesText}
        disabled={disabled}
        placeholder={copy.custom.valuesPlaceholder}
        aria-describedby="shop-attr-custom-values-hint"
        onChange={(e) => setValuesText(e.target.value)}
      />
      <small id="shop-attr-custom-values-hint" className="shop-attr-picker__hint">
        {copy.custom.valuesHint}
      </small>
      <div className="shop-attr-picker__foot">
        <Button tone="primary" type="button" disabled={disabled || !canAdd} onClick={add}>
          {copy.add}
        </Button>
      </div>
    </div>
  );
}
