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

type PickerMode = 'global' | 'custom';

interface ShopAttributePickerProps {
  connectionId: string;
  /** Fires with a neutral product-section parameter for each attribute added. */
  onAdd: (parameter: OfferParameter) => void;
  disabled?: boolean;
}

const MODE_OPTIONS = [
  { value: 'global' as const, label: 'Global attribute' },
  { value: 'custom' as const, label: 'Custom' },
];

export function ShopAttributePicker({
  connectionId,
  onAdd,
  disabled = false,
}: ShopAttributePickerProps): ReactElement {
  const [mode, setMode] = useState<PickerMode>('global');

  return (
    <div className="shop-attr-picker">
      <SegmentedControl
        options={MODE_OPTIONS}
        value={mode}
        onChange={setMode}
        aria-label="Attribute type"
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
    return <LoadingState liveRegion="off" title="Loading attributes" message="Fetching global attributes..." />;
  }
  if (attributesQuery.error) {
    return (
      <ErrorState
        title="Unable to load attributes"
        message={attributesQuery.error.message}
        action={<Button onClick={() => void attributesQuery.refetch()}>Retry</Button>}
      />
    );
  }
  if (attributes.length === 0) {
    return (
      <div className="shop-attr-picker__empty">
        This shop has no global attributes. Use a custom attribute instead.
      </div>
    );
  }

  return (
    <div className="shop-attr-picker__panel">
      <label className="shop-attr-picker__label" htmlFor="shop-attr-select">
        Attribute
      </label>
      <Select
        id="shop-attr-select"
        value={attributeId}
        disabled={disabled}
        onChange={(e) => selectAttribute(e.target.value)}
      >
        <option value="">Choose an attribute...</option>
        {attributes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      {attributeId ? (
        termsQuery.isLoading ? (
          <LoadingState liveRegion="off" title="Loading terms" message="Fetching terms..." />
        ) : termsQuery.error ? (
          <ErrorState
            title="Unable to load terms"
            message={termsQuery.error.message}
            action={<Button onClick={() => void termsQuery.refetch()}>Retry</Button>}
          />
        ) : terms.length === 0 ? (
          <div className="shop-attr-picker__empty">This attribute has no predefined terms.</div>
        ) : (
          <fieldset className="shop-attr-picker__terms">
            <legend className="shop-attr-picker__label">Terms</legend>
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
          Add attribute
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
        Name
      </label>
      <Input
        id="shop-attr-custom-name"
        value={name}
        disabled={disabled}
        placeholder="e.g. Material"
        onChange={(e) => setName(e.target.value)}
      />
      <label className="shop-attr-picker__label" htmlFor="shop-attr-custom-values">
        Values
      </label>
      <Input
        id="shop-attr-custom-values"
        value={valuesText}
        disabled={disabled}
        placeholder="Comma separated, e.g. Cotton, Wool"
        aria-describedby="shop-attr-custom-values-hint"
        onChange={(e) => setValuesText(e.target.value)}
      />
      <small id="shop-attr-custom-values-hint" className="shop-attr-picker__hint">
        Free-text custom attribute - not backed by a store taxonomy, so it will not power storefront
        filtering.
      </small>
      <div className="shop-attr-picker__foot">
        <Button tone="primary" type="button" disabled={disabled || !canAdd} onClick={add}>
          Add attribute
        </Button>
      </div>
    </div>
  );
}
