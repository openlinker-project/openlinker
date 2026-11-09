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
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
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
  receiptName,
  settingsFromSuggestion,
  stillEqualsSuggestion,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';
import { useDeliveryLineSuggestionsQuery } from '../hooks/use-delivery-on-documents-queries';
import { DocumentsPreview } from './delivery-documents-preview';
import { HeadWithTip, useDeliveryTips } from './delivery-rules-table';

export interface EditorTarget {
  mode: 'add' | 'edit';
  country: string | null;
  settings: DeliveryFormSettings;
}

const CUSTOM = '__custom';
const FILL_OTHER = 'other';
const FILL_NEUTRAL = 'neutral';
/** The example rate the "How receipts write the rate" options are shown with. */
const SAMPLE_RATE = '23';

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
  const copy = useMessages('delivery-on-documents').nameInput;
  const all = options.includes(value) ? options : [value, ...options];
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState('');
  // The budget is the connected fiscalization adapters' declaration, served
  // with the suggestions (already cached by every surface that opens this
  // dialog); until it arrives the shared fallback applies.
  const receiptLineNameLength = useDeliveryLineSuggestionsQuery().data?.receiptLineName?.maxLength;
  const check = checkName(draft, format, receiptLineNameLength);
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
        <option value={CUSTOM}>{copy.typeOwn}</option>
      </Select>
      {own ? (
        <div className="dd-name__own">
          <Input
            aria-label={interpolate(copy.ownLabel, { label })}
            value={draft}
            invalid={Boolean(draft) && Boolean(check.error)}
            placeholder={copy.placeholder}
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
                : interpolate(copy.characters, {
                    count: check.name.length,
                    max: maxName(format, receiptLineNameLength),
                  })}
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
              {copy.useName}
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
  const copy = useMessages('delivery-on-documents');
  const ed = copy.editor;
  const plural = usePlural();
  const tips = useDeliveryTips();
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
          ? plural(ordersFrom(c), ed.country.orders)
          : suggestionByCountry.has(c)
            ? ed.country.suggestionAvailable
            : c,
      disabled: taken.includes(c) && c !== target.country,
      disabledReason: ed.country.alreadyListed,
    }));
  }, [factByCountry, suggestionByCountry, taken, target.country, plural, ed]);

  const suggestion = country ? suggestionByCountry.get(country) ?? null : null;
  const update = (patch: Partial<DeliveryFormSettings>): void =>
    setS((prev) => ({ ...prev, ...patch }));

  const fillOptions = [
    ...(isOther
      ? [
          {
            value: FILL_NEUTRAL,
            label: interpolate(ed.fill.openLinkerDefault, { name: neutralSettings().name }),
          },
        ]
      : [{ value: FILL_OTHER, label: ed.fill.sameAsOther }]),
    ...suggestions
      .filter((x) => isOther || x.country === country)
      .map((x) => ({
        value: x.country,
        label: interpolate(ed.fill.suggestedFor, { country: countryName(x.country) }),
      })),
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
      ? ed.addTitle
      : isOther
        ? copy.common.allOtherCountries
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
        {isOther ? ed.descriptionOther : ed.descriptionCountry}
      </DialogDescription>

      <div className="dd-editor__grid">
        <div className="dd-editor__form">
          {target.mode === 'add' ? (
            <FormField
              label={ed.country.label}
              name="dd-country"
              description={ed.country.description}
            >
              <Combobox
                options={countryOptions}
                value={country ? { kind: 'dictionary', ids: [country] } : null}
                filterFirstThreshold={1000}
                placeholder={ed.country.placeholder}
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
                label={ed.fill.label}
                name="dd-fill"
                description={
                  !isOther && country && !suggestion
                    ? interpolate(ed.fill.noSuggestion, { country: countryName(country) })
                    : ed.fill.description
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
                  <option value="">{fillValue ? '' : ed.fill.ownSettings}</option>
                  {fillOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label={<HeadWithTip label={ed.name.label} tips={tips.line} />}
                name="dd-name"
                description={ed.name.description}
              >
                <NameInput
                  key={`${country}-${marker}`}
                  label={ed.name.label}
                  value={s.name}
                  options={nameOptions}
                  format={s.rateFormat}
                  onChange={(name) => update({ name })}
                />
              </FormField>

              <FormField
                label={<HeadWithTip label={ed.rate.label} tips={tips.rate} />}
                name="dd-rate"
              >
                <Select
                  value={s.rate}
                  onChange={(e) => update({ rate: e.target.value as DeliveryFormSettings['rate'] })}
                >
                  <option value="goods">{ed.rate.goods}</option>
                  <option value="fixed">{ed.rate.fixed}</option>
                  <option value="spread">{ed.rate.spread}</option>
                </Select>
              </FormField>
              {s.rate === 'fixed' ? (
                <div className="dd-fixed">
                  <FormField label={ed.fixedRate.label} name="dd-fixed-rate">
                    <Input
                      inputMode="decimal"
                      value={s.fixedRate}
                      placeholder={ed.fixedRate.placeholder}
                      onChange={(e) =>
                        update({ fixedRate: e.target.value.replace(/[^\d.,]/g, '') })
                      }
                    />
                  </FormField>
                  {ratesSeen.length ? (
                    <div className="dd-fixed__seen">
                      <span className="dd-hint">
                        {interpolate(ed.fixedRate.seen, {
                          country: country ? countryName(country) : '',
                        })}
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

              <FormField label={ed.free.label} name="dd-free">
                <Select
                  value={s.freeDelivery}
                  onChange={(e) =>
                    update({ freeDelivery: e.target.value as DeliveryFormSettings['freeDelivery'] })
                  }
                >
                  <option value="omit">{ed.free.omit}</option>
                  <option value="show">{ed.free.show}</option>
                </Select>
              </FormField>

              <button
                type="button"
                className="dd-more"
                aria-expanded={more}
                onClick={() => setMore((v) => !v)}
              >
                {more ? ed.fewerOptions : ed.moreOptions}
              </button>
              {more ? (
                <div className="dd-more__body">
                  <FormField label={ed.rateFormatLabel} name="dd-format">
                    <Select
                      value={s.rateFormat}
                      onChange={(e) =>
                        update({ rateFormat: e.target.value as DeliveryLineRateFormat })
                      }
                    >
                      <option value="plain">
                        {receiptName({ ...s, rateFormat: 'plain' }, SAMPLE_RATE)}
                      </option>
                      <option value="brackets">
                        {receiptName({ ...s, rateFormat: 'brackets' }, SAMPLE_RATE)}
                      </option>
                      <option value="labelled">
                        {receiptName({ ...s, rateFormat: 'labelled' }, SAMPLE_RATE)}
                      </option>
                    </Select>
                  </FormField>
                  <label className="rate-limit-section__toggle dd-check">
                    <input
                      type="checkbox"
                      checked={s.invoiceName !== null}
                      onChange={(e) => update({ invoiceName: e.target.checked ? s.name : null })}
                    />
                    <span>{ed.invoiceName.toggle}</span>
                  </label>
                  {s.invoiceName !== null ? (
                    <NameInput
                      key="inv"
                      label={ed.invoiceName.label}
                      value={s.invoiceName}
                      options={nameOptions}
                      format="plain"
                      onChange={(invoiceName) => update({ invoiceName })}
                    />
                  ) : null}
                  <div className="dd-methods">
                    <span className="dd-methods__title">{ed.methods.title}</span>
                    {Object.entries(s.methodNames).map(([id, n]) => (
                      <div key={id} className="dd-methods__row">
                        <span className="dd-methods__method">{methodLabel(id)}</span>
                        <NameInput
                          key={id}
                          label={interpolate(ed.methods.nameFor, { method: methodLabel(id) })}
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
                          {ed.methods.remove}
                        </Button>
                      </div>
                    ))}
                    {unnamed.length ? (
                      <Select
                        aria-label={ed.methods.addLabel}
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          update({ methodNames: { ...s.methodNames, [e.target.value]: s.name } })
                        }
                      >
                        <option value="">{ed.methods.addOption}</option>
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
            <p className="dd-hint">{ed.chooseCountry}</p>
          )}
        </div>

        <aside className="dd-editor__preview" aria-label={ed.preview.label}>
          <div className="dd-editor__preview-head">
            <span className="dd-preview-title">{ed.preview.label}</span>
            {isOther && previewChoices.length && previewCountry ? (
              <Select
                aria-label={copy.common.exampleOrderFrom}
                value={previewCountry}
                onChange={(e) => setPreviewCountry(e.target.value)}
              >
                {previewChoices.map((f) => (
                  <option key={f.country} value={f.country}>
                    {interpolate(copy.common.orderFrom, { country: countryName(f.country) })}
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
            <p className="dd-hint">{ed.preview.empty}</p>
          )}
          {markerSuggestion && stillSuggested ? (
            <p className="dd-hint dd-inline">
              {interpolate(ed.preview.suggestedFrom, {
                country: countryName(markerSuggestion.country),
              })}
              <Infotip
                ariaLabel={copy.common.suggestionBasis}
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
            {interpolate(ed.removeCountry, { country: countryName(target.country) })}
          </Button>
        ) : null}
        <Button tone="secondary" onClick={onClose}>
          {ed.cancel}
        </Button>
        <Button
          disabled={!canSave}
          onClick={() => onSave(target.mode === 'add' ? country : target.country, s)}
        >
          {target.mode === 'add' ? ed.addCountry : ed.save}
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
