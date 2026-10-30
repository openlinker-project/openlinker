/**
 * Delivery on documents - editor dialog (#3908)
 *
 * Adds or edits one row of the table with a live preview of the receipt and
 * the invoice. Ported from the approved mockup; the data layer is the real
 * suggestions / country-facts queries and the connection's own delivery
 * methods. The suggestion marker is UI-only: it is derived by comparing the
 * fields to the suggestion and is never persisted.
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Combobox, type ComboboxOption } from '../../../shared/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Infotip } from '../../../shared/ui/infotip';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { ISO_3166_1_COUNTRIES } from '../../../shared/lib/iso-3166-1-countries';
import type { MappingOption } from '../../mappings';
import type {
  DeliveryCountryFact,
  DeliveryLineSuggestion,
} from '../api/delivery-on-documents.types';
import type { DeliveryLineRateFormat } from '../lib/delivery-line';
import {
  GENERIC_NAMES,
  checkName,
  countryName,
  maxName,
  neutralSettings,
  rateLabel,
  settingsFromSuggestion,
  stillEqualsSuggestion,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';
import { DocumentsPreview } from './delivery-documents-preview';
import { HeadWithTip, TIP_LINE, TIP_RATE } from './delivery-rules-table';

export interface EditorTarget {
  mode: 'add' | 'edit';
  country: string | null;
  settings: DeliveryFormSettings;
}

const CUSTOM = '__custom';
const FILL_OTHER = 'other';
const FILL_NEUTRAL = 'neutral';

function NameInput({
  value,
  options,
  format,
  onChange,
  label,
  id,
}: {
  value: string;
  options: readonly string[];
  format: DeliveryLineRateFormat;
  onChange: (v: string) => void;
  label: string;
  id?: string;
}): ReactElement {
  const all = options.includes(value) ? options : [value, ...options];
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState('');
  const check = checkName(draft, format);
  return (
    <div className="dd-name">
      <Select
        id={id}
        aria-label={label}
        value={own ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setOwn(true);
            setDraft('');
            return;
          }
          setOwn(false);
          onChange(e.target.value);
        }}
      >
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={CUSTOM}>Type my own…</option>
      </Select>
      {own ? (
        <div className="dd-name__own">
          <Input
            aria-label={`${label}, your own`}
            value={draft}
            invalid={Boolean(draft) && Boolean(check.error)}
            placeholder="For example: Doprava, Versand, Envío"
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !check.error) {
                e.preventDefault();
                onChange(check.name);
                setOwn(false);
              }
            }}
          />
          <div className="dd-inline">
            <p
              className={draft && check.error ? 'form-field__error' : 'form-field__description'}
              role={draft && check.error ? 'alert' : undefined}
            >
              {draft && check.error
                ? check.error
                : `${check.name.length} of ${maxName(format)} characters`}
            </p>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={Boolean(check.error)}
              onClick={() => {
                onChange(check.name);
                setOwn(false);
              }}
            >
              Use this name
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface EditorFormProps {
  target: EditorTarget;
  rules: readonly DeliveryRule[];
  facts: readonly DeliveryCountryFact[];
  suggestions: readonly DeliveryLineSuggestion[];
  deliveryMethods: readonly MappingOption[];
  busy: boolean;
  onClose: () => void;
  onSave: (country: string | null, settings: DeliveryFormSettings) => void;
  onRemove: (country: string) => void;
  /** Reports unsaved edits up so the page can guard a tab switch. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** The suggestion a row was filled from, while it still equals it. */
function initialMarker(
  target: EditorTarget,
  suggestions: readonly DeliveryLineSuggestion[],
): string | null {
  const candidates =
    target.country === null ? suggestions : suggestions.filter((s) => s.country === target.country);
  return candidates.find((s) => stillEqualsSuggestion(target.settings, s))?.country ?? null;
}

function EditorForm({
  target,
  rules,
  facts,
  suggestions,
  deliveryMethods,
  busy,
  onClose,
  onSave,
  onRemove,
  onDirtyChange,
}: EditorFormProps): ReactElement {
  const [s, setS] = useState<DeliveryFormSettings>(target.settings);
  const [country, setCountry] = useState<string | null>(target.country);
  const [marker, setMarker] = useState<string | null>(() => initialMarker(target, suggestions));
  const [more, setMore] = useState(
    target.settings.invoiceName !== null ||
      target.settings.rateFormat !== 'plain' ||
      Object.keys(target.settings.methodNames).length > 0,
  );

  const taken = useMemo(
    () => rules.map((r) => r.country).filter((c): c is string => c !== null),
    [rules],
  );
  const factByCountry = useMemo(() => new Map(facts.map((f) => [f.country, f])), [facts]);
  const suggestionByCountry = useMemo(
    () => new Map(suggestions.map((x) => [x.country, x])),
    [suggestions],
  );

  const isDirty =
    country !== target.country || JSON.stringify(s) !== JSON.stringify(target.settings);
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const otherRow = rules.find((r) => r.country === null)?.settings ?? neutralSettings();
  const isOther = target.mode === 'edit' && target.country === null;

  const [previewCountry, setPreviewCountry] = useState<string | null>(() => {
    if (target.country !== null) return target.country;
    return (
      facts
        .filter((f) => f.example !== null && !taken.includes(f.country))
        .sort((a, b) => b.orders30d - a.orders30d)[0]?.country ?? null
    );
  });

  const countryOptions: ComboboxOption[] = useMemo(() => {
    const ordersFrom = (code: string): number => factByCountry.get(code)?.orders30d ?? 0;
    const codes = ISO_3166_1_COUNTRIES.map((c) => c.code);
    const withOrders = codes
      .filter((c) => ordersFrom(c) > 0)
      .sort((a, b) => ordersFrom(b) - ordersFrom(a));
    const rest = codes
      .filter((c) => ordersFrom(c) === 0)
      .sort((a, b) => countryName(a).localeCompare(countryName(b)));
    return [...withOrders, ...rest].map((c) => ({
      id: c,
      label: countryName(c),
      hint:
        ordersFrom(c) > 0
          ? `${ordersFrom(c)} orders in 30 days`
          : suggestionByCountry.has(c)
            ? 'suggestion available'
            : c,
      disabled: taken.includes(c) && c !== target.country,
      disabledReason: 'Already in the table',
    }));
  }, [factByCountry, suggestionByCountry, taken, target.country]);

  const suggestion = country ? suggestionByCountry.get(country) ?? null : null;
  const update = (patch: Partial<DeliveryFormSettings>): void =>
    setS((prev) => ({ ...prev, ...patch }));

  const fillOptions = [
    ...(isOther
      ? [{ value: FILL_NEUTRAL, label: `OpenLinker default (${neutralSettings().name})` }]
      : [{ value: FILL_OTHER, label: 'The same as "All other countries"' }]),
    ...suggestions
      .filter((x) => isOther || x.country === country)
      .map((x) => ({ value: x.country, label: `Suggested for ${countryName(x.country)}` })),
  ];
  const markerSuggestion = marker ? suggestionByCountry.get(marker) ?? null : null;
  const stillSuggested = markerSuggestion ? stillEqualsSuggestion(s, markerSuggestion) : false;
  const fillValue = stillSuggested && marker ? marker : '';

  const nameOptions = [
    ...new Set([
      ...(suggestion?.nameSuggestions ?? []),
      ...(isOther ? suggestions.flatMap((x) => x.nameSuggestions) : []),
      ...GENERIC_NAMES,
    ]),
  ];
  const fact = country ? factByCountry.get(country) ?? null : null;
  const ratesSeen = fact?.ratesSeen ?? [];
  const unnamed = deliveryMethods.filter((m) => !(m.value in s.methodNames));
  const previewFor = isOther ? previewCountry : country;
  const previewChoices = facts.filter((f) => f.example !== null && !taken.includes(f.country));
  const title =
    target.mode === 'add'
      ? 'Add a country'
      : isOther
        ? 'All other countries'
        : countryName(target.country ?? '');
  const canSave =
    !busy &&
    (target.mode !== 'add' || country !== null) &&
    Boolean(s.name) &&
    (s.rate !== 'fixed' || Boolean(s.fixedRate));
  const methodLabel = (id: string): string =>
    deliveryMethods.find((m) => m.value === id)?.label ?? id;

  const applySuggestion = (x: DeliveryLineSuggestion): void => {
    setS(settingsFromSuggestion(x));
    setMarker(x.country);
  };

  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>
        {isOther
          ? 'Used for every buyer country that is not listed in the table.'
          : 'Orders delivered to this country use these settings.'}
      </DialogDescription>

      <div className="dd-editor__grid">
        <div className="dd-editor__form">
          {target.mode === 'add' ? (
            <FormField
              label="Buyer country"
              name="dd-country"
              description="Any country. Countries you already get orders from are at the top."
            >
              <Combobox
                options={countryOptions}
                value={country ? { kind: 'dictionary', ids: [country] } : null}
                filterFirstThreshold={1000}
                placeholder="Search for a country…"
                onChange={(next) => {
                  const code = next?.kind === 'dictionary' ? next.ids[0] ?? null : null;
                  setCountry(code);
                  if (!code) return;
                  const found = suggestionByCountry.get(code);
                  if (found) applySuggestion(found);
                  else {
                    setS({ ...otherRow });
                    setMarker(null);
                  }
                }}
              />
            </FormField>
          ) : null}

          {target.mode !== 'add' || country ? (
            <>
              <FormField
                label="Fill in from"
                name="dd-fill"
                description={
                  !isOther && country && !suggestion
                    ? `OpenLinker has no suggestion for ${countryName(country)} yet. Check the VAT on delivery with your accountant.`
                    : 'Fills the fields below. Change anything afterwards.'
                }
              >
                <Select
                  value={fillValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === FILL_OTHER) {
                      setS({ ...otherRow });
                      setMarker(null);
                    } else if (v === FILL_NEUTRAL) {
                      setS(neutralSettings());
                      setMarker(null);
                    } else if (v) {
                      const found = suggestionByCountry.get(v);
                      if (found) applySuggestion(found);
                    }
                  }}
                >
                  <option value="">{fillValue ? '' : 'Your own settings'}</option>
                  {fillOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label={<HeadWithTip label="Name of the delivery line" tips={TIP_LINE} />}
                name="dd-name"
                description="Pick one or type your own, in any language."
              >
                <NameInput
                  key={`${country}-${marker}`}
                  label="Name of the delivery line"
                  value={s.name}
                  options={nameOptions}
                  format={s.rateFormat}
                  onChange={(name) => update({ name })}
                />
              </FormField>

              <FormField
                label={<HeadWithTip label="VAT rate of delivery" tips={TIP_RATE} />}
                name="dd-rate"
              >
                <Select
                  value={s.rate}
                  onChange={(e) => update({ rate: e.target.value as DeliveryFormSettings['rate'] })}
                >
                  <option value="goods">Same as the products</option>
                  <option value="fixed">One fixed rate</option>
                  <option value="spread">Add delivery to the product prices</option>
                </Select>
              </FormField>
              {s.rate === 'fixed' ? (
                <div className="dd-fixed">
                  <FormField label="Fixed rate in %" name="dd-fixed-rate">
                    <Input
                      inputMode="decimal"
                      value={s.fixedRate}
                      placeholder="For example 21"
                      onChange={(e) =>
                        update({ fixedRate: e.target.value.replace(/[^\d.,]/g, '') })
                      }
                    />
                  </FormField>
                  {ratesSeen.length ? (
                    <div className="dd-fixed__seen">
                      <span className="dd-hint">
                        Rates in your {country ? countryName(country) : ''} orders
                      </span>
                      <div className="dd-inline">
                        {ratesSeen.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={`chip${s.fixedRate === r ? ' chip--active' : ''}`}
                            onClick={() => update({ fixedRate: r })}
                          >
                            {rateLabel(r)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <FormField label="When delivery is free" name="dd-free">
                <Select
                  value={s.freeDelivery}
                  onChange={(e) =>
                    update({ freeDelivery: e.target.value as DeliveryFormSettings['freeDelivery'] })
                  }
                >
                  <option value="omit">Leave the delivery line out</option>
                  <option value="show">Show the line with 0</option>
                </Select>
              </FormField>

              <button
                type="button"
                className="dd-more"
                aria-expanded={more}
                onClick={() => setMore((v) => !v)}
              >
                {more ? 'Fewer options' : 'More options'}
              </button>
              {more ? (
                <div className="dd-more__body">
                  <FormField label="How receipts write the rate" name="dd-format">
                    <Select
                      value={s.rateFormat}
                      onChange={(e) =>
                        update({ rateFormat: e.target.value as DeliveryLineRateFormat })
                      }
                    >
                      <option value="plain">{`${s.name} 23%`}</option>
                      <option value="brackets">{`${s.name} (23%)`}</option>
                      <option value="vat">{`${s.name} VAT 23%`}</option>
                    </Select>
                  </FormField>
                  <label className="rate-limit-section__toggle dd-check">
                    <input
                      type="checkbox"
                      checked={s.invoiceName !== null}
                      onChange={(e) => update({ invoiceName: e.target.checked ? s.name : null })}
                    />
                    <span>Different name on invoices</span>
                  </label>
                  {s.invoiceName !== null ? (
                    <NameInput
                      key="inv"
                      label="Name on invoices"
                      value={s.invoiceName}
                      options={nameOptions}
                      format="plain"
                      onChange={(invoiceName) => update({ invoiceName })}
                    />
                  ) : null}
                  <div className="dd-methods">
                    <span className="dd-methods__title">Own name for a delivery method</span>
                    {Object.entries(s.methodNames).map(([id, n]) => (
                      <div key={id} className="dd-methods__row">
                        <span className="dd-methods__method">{methodLabel(id)}</span>
                        <NameInput
                          key={id}
                          label={`Name for ${methodLabel(id)}`}
                          value={n}
                          options={nameOptions}
                          format={s.rateFormat}
                          onChange={(next) =>
                            update({ methodNames: { ...s.methodNames, [id]: next } })
                          }
                        />
                        <Button
                          tone="ghost"
                          className="button--sm"
                          onClick={() => {
                            const rest = { ...s.methodNames };
                            delete rest[id];
                            update({ methodNames: rest });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    {unnamed.length ? (
                      <Select
                        aria-label="Add a delivery method"
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          update({ methodNames: { ...s.methodNames, [e.target.value]: s.name } })
                        }
                      >
                        <option value="">+ Add a delivery method…</option>
                        {unnamed.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="dd-hint">Choose a country to see its settings.</p>
          )}
        </div>

        <aside className="dd-editor__preview" aria-label="Preview">
          <div className="dd-editor__preview-head">
            <span className="dd-preview-title">Preview</span>
            {isOther && previewChoices.length && previewCountry ? (
              <Select
                aria-label="Example order from"
                value={previewCountry}
                onChange={(e) => setPreviewCountry(e.target.value)}
              >
                {previewChoices.map((f) => (
                  <option key={f.country} value={f.country}>
                    Order from {countryName(f.country)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          {target.mode !== 'add' || country ? (
            <DocumentsPreview
              settings={s}
              country={previewFor}
              fact={previewFor ? factByCountry.get(previewFor) ?? null : null}
            />
          ) : (
            <p className="dd-hint">Nothing to show yet.</p>
          )}
          {markerSuggestion && stillSuggested ? (
            <p className="dd-hint dd-inline">
              Suggested from {countryName(markerSuggestion.country)} VAT practice
              <Infotip
                ariaLabel="What the suggestion is based on"
                definitions={markerSuggestion.sources}
                align="end"
              />
            </p>
          ) : null}
        </aside>
      </div>

      <DialogFooter>
        {target.mode === 'edit' &&
        target.country &&
        rules.some((r) => r.country === target.country) ? (
          <Button
            tone="ghost"
            className="dd-remove"
            disabled={busy}
            onClick={() => target.country && onRemove(target.country)}
          >
            Remove {countryName(target.country)}
          </Button>
        ) : null}
        <Button tone="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canSave}
          onClick={() => onSave(target.mode === 'add' ? country : target.country, s)}
        >
          {target.mode === 'add' ? 'Add country' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}

interface DeliveryLineEditorDialogProps extends Omit<EditorFormProps, 'target'> {
  target: EditorTarget | null;
}

export function DeliveryLineEditorDialog({
  target,
  onClose,
  ...rest
}: DeliveryLineEditorDialogProps): ReactElement {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="dd-editor" style={{ width: 'min(56rem, 94vw)', maxWidth: 'none' }}>
        {target ? <EditorForm target={target} onClose={onClose} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}
