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
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { FieldArrayWithId, UseFieldArrayReturn, UseFormReturn } from 'react-hook-form';
import { formatPlural, interpolate, useFormat, useLocale, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { HelpHint } from '../../../shared/ui/help-hint';
import { Input } from '../../../shared/ui/input';
import { EASE_OUT, SNAPPY_SPRING } from '../../../shared/ui/motion-presets';
import { useToast } from '../../../shared/ui/toast-provider';
import { VariantThumbnail } from '../../products';
import {
  MAX_COMPONENT_QUANTITY,
  SOFT_COMPONENT_LIMIT,
  type BundleFormRow,
  type BundleFormValues,
  type CompositionProblem,
  type ParsedRow,
} from '../lib/bundle-form-model';

export { MAX_COMPONENT_QUANTITY };
import type { BundleProductChoice } from '../lib/bundle-choice';
import { BundleVariantPicker } from './bundle-variant-picker';

const HIGHLIGHT_MS = 1400;
const MINUS_GLYPH = '\u2212';
const PLUS_GLYPH = '+';
const MULTIPACK_SIZES = [2, 3, 4, 6, 12] as const;

export interface BundleStepComponentsProps {
  form: UseFormReturn<BundleFormValues>;
  components: UseFieldArrayReturn<BundleFormValues, 'components'>;
  rows: BundleFormValues['components'];
  parsedRows: ParsedRow[];
  readOnly: boolean;
  limitedName: string | null;
  showErrors: boolean;
  /** Why this composition cannot be a bundle yet, when it cannot. */
  problem?: CompositionProblem | null;
  onAdd: (choice: BundleProductChoice) => void;
  /** The bundle's own product variant: it can never be its own component. */
  blockedVariantIds?: readonly string[];
}

type QuantityProblem = 'min' | 'whole' | 'max';

/** Says what is wrong with a typed quantity, so the message can be specific. */
export function quantityProblem(raw: string): QuantityProblem | null {
  const text = raw.trim();
  if (text === '' || /^0+$/.test(text)) return 'min';
  // Below one, whether negative or a fraction, is "at least 1"; "whole" is for what is not a plain integer.
  if (/^[+-]?\d+(\.\d+)?$/.test(text) && Number(text) < 1) return 'min';
  if (!/^\d+$/.test(text)) return 'whole';
  return Number(text) > MAX_COMPONENT_QUANTITY ? 'max' : null;
}

function TrashIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="bf-icon">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M6.75 7v3.5M9.25 7v3.5" />
    </svg>
  );
}

export function BundleStepComponents({
  form,
  components,
  rows,
  parsedRows,
  readOnly,
  limitedName,
  showErrors,
  problem = null,
  onAdd,
  blockedVariantIds,
}: BundleStepComponentsProps): ReactElement {
  const copy = useMessages('bundles').form;
  const { locale } = useLocale();
  const format = useFormat();
  const { showToast } = useToast();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [moved, setMoved] = useState<string>('');
  const [pendingFocus, setPendingFocus] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);

  // Rows that were already there on mount (editing) must not flash; only one
  // that arrives later is the one the operator just added.
  useEffect(() => {
    const ids = components.fields.map((field) => field.id);
    if (seenIds.current === null) {
      seenIds.current = new Set(ids);
      return;
    }
    const known = seenIds.current;
    const added = ids.find((id) => !known.has(id));
    ids.forEach((id) => known.add(id));
    if (added === undefined) return;
    setFresh(added);
    const timer = window.setTimeout(() => {
      setFresh((current) => (current === added ? null : current));
    }, HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [components.fields]);

  // After a move the button that was pressed sits on a different index (or is
  // now disabled); give the focus back so the keyboard can keep going.
  useEffect(() => {
    if (pendingFocus === null) return;
    const root = listRef.current;
    const wanted = root?.querySelector<HTMLButtonElement>(
      `[data-move="${pendingFocus.id}:${pendingFocus.dir}"]`
    );
    const other = root?.querySelector<HTMLButtonElement>(
      `[data-move="${pendingFocus.id}:${pendingFocus.dir === 'up' ? 'down' : 'up'}"]`
    );
    (wanted !== null && wanted !== undefined && !wanted.disabled ? wanted : other)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const removeRow = (index: number, row: BundleFormRow): void => {
    const snapshot: BundleFormRow = { ...row };
    components.remove(index);
    showToast({
      description: interpolate(copy.removed, { name: row.name }),
      tone: 'info',
      durationMs: 7000,
      testId: 'bundle-form-component-removed-toast',
      action: {
        label: copy.undo,
        onClick: () => {
          components.insert(Math.min(index, components.fields.length), snapshot);
        },
      },
    });
  };

  const setQuantity = (index: number, value: number): void => {
    form.setValue(`components.${index}.quantity`, String(value), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const moveRow = (index: number, dir: 'up' | 'down', id: string, name: string): void => {
    const to = dir === 'up' ? index - 1 : index + 1;
    components.move(index, to);
    setMoved(interpolate(copy.movedTo, { name, n: to + 1, total: components.fields.length }));
    setPendingFocus({ id, dir });
  };

  return (
    <div className="bf-step">
      <p className="bf-lead">{copy.s1Lead}</p>
      <p className="bf-example" data-testid="bundle-form-example">
        {copy.s1Example}
      </p>
      <div className="form-field pm-combo">
        <BundleVariantPicker
          label={copy.addComponent}
          placeholder={copy.searchComponent}
          disabled={readOnly}
          excludeVariantIds={rows.map((row) => row.variantId)}
          blockedVariantIds={blockedVariantIds}
          disallowBundles
          multiPaste
          inputRef={searchRef}
          onPick={onAdd}
          testIdPrefix="bundle-form-component-search"
        />
      </div>
      <div className="bf-listhead">
        <h3 className="bf-h3">{formatPlural(rows.length, copy.componentsCount, locale)}</h3>
        {rows.length > 0 ? (
          <span className="bf-listhead__help">
            {copy.s1GiftHelp}
            <HelpHint guide="g-gift" label={copy.s1Help} />
          </span>
        ) : null}
      </div>
      {rows.length > SOFT_COMPONENT_LIMIT ? (
        <p className="bf-compnote" data-testid="bundle-form-too-many">
          {copy.tooManyComponents}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <p className="bf-qtyhelp">
          {copy.qtyHelp} {copy.s1Fixed}
        </p>
      ) : null}
      {problem !== null ? (
        <p
          className={`bf-compnote${showErrors ? ' is-error' : ''}`}
          role={showErrors ? 'alert' : undefined}
          data-testid="bundle-form-composition-note"
        >
          {problem === 'no-paid' ? copy.compositionNoPaid : copy.compositionSinglePiece}
        </p>
      ) : null}
      {rows.length === 1 && rows[0] !== undefined ? (
        <div className="bf-multipack" role="group" aria-label={copy.multipackLabel} data-testid="bundle-form-multipack">
          <span className="bf-multipack__l">{copy.multipackLabel}</span>
          {MULTIPACK_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className="bf-multipack__btn"
              disabled={readOnly}
              aria-pressed={parsedRows[0]?.qty === n}
              aria-label={interpolate(copy.multipackSet, { n, name: rows[0]?.name ?? '' })}
              data-testid={`bundle-form-multipack-${n}`}
              onClick={() => {
                setQuantity(0, n);
              }}
            >
              {`\u00d7${n}`}
            </button>
          ))}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {moved}
      </p>

      <ul className="cx-rows" data-testid="bundle-form-components" ref={listRef}>
        <AnimatePresence initial={false}>
          {components.fields.map((field: FieldArrayWithId<BundleFormValues, 'components'>, index) => {
            const row = rows[index];
            const parsed = parsedRows[index];
            if (row === undefined || parsed === undefined) return null;
            const key = row.sku ?? row.variantId;
            const problem = quantityProblem(row.quantity);
            const invalidQuantity = form.formState.errors.components?.[index]?.quantity !== undefined || problem !== null;
            const isLimiting = limitedName !== null && row.name === limitedName;
            const stock = row.availableToPromise;
            const sets = parsed.qty > 0 && stock !== null ? Math.floor(stock / parsed.qty) : null;
            const out = stock === 0;
            const overStock = stock !== null && stock > 0 && parsed.qty > stock;
            const message = invalidQuantity
              ? problem === 'max'
                ? copy.qtyMax
                : problem === 'whole'
                  ? copy.qtyWhole
                  : problem === 'min'
                    ? copy.qtyMin
                    : copy.quantityInvalid
              : overStock
                ? interpolate(copy.qtyOverStock, { n: stock })
                : '';
            const msgId = `bundle-form-component-msg-${field.id}`;
            const attrsLabel = row.attributes ? interpolate(copy.variantLabel, { attrs: row.attributes }) : null;
            return (
              <motion.li
                key={field.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  height: 0,
                  paddingTop: 0,
                  paddingBottom: 0,
                  borderWidth: 0,
                  overflow: 'hidden',
                  transition: { duration: 0.16, ease: EASE_OUT },
                }}
                transition={SNAPPY_SPRING}
                className={`cx-row bf-comp${row.gift ? ' is-gift' : ''}${isLimiting ? ' is-lim' : ''}${
                  invalidQuantity ? ' is-invalid' : ''
                }${fresh === field.id ? ' is-fresh' : ''}`}
                data-testid={`bundle-form-component-row-${key}`}
              >
                <div className="bf-comp__grid">
                  <span className="bf-comp__ord">
                    <button
                      type="button"
                      className="bf-mv"
                      data-move={`${field.id}:up`}
                      disabled={readOnly || index === 0}
                      aria-label={interpolate(copy.moveUp, { name: row.name })}
                      title={interpolate(copy.moveUp, { name: row.name })}
                      onClick={() => {
                        moveRow(index, 'up', field.id, row.name);
                      }}
                    >
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 7.5 6 4l3.5 3.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="bf-mv"
                      data-move={`${field.id}:down`}
                      disabled={readOnly || index === components.fields.length - 1}
                      aria-label={interpolate(copy.moveDown, { name: row.name })}
                      title={interpolate(copy.moveDown, { name: row.name })}
                      onClick={() => {
                        moveRow(index, 'down', field.id, row.name);
                      }}
                    >
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </button>
                  </span>
                  <VariantThumbnail src={row.imageUrl} name={row.name} size="md" />
                  <span className="bf-comp__main">
                    <span className="bf-comp__title">
                      <span className="bf-comp__name">{row.name}</span>
                      {row.gift ? <span className="cx-tag cx-tag--gift">{copy.gift}</span> : null}
                    </span>
                    {attrsLabel ? <span className="bf-comp__attrs">{attrsLabel}</span> : null}
                    <span className="bf-comp__codes mono" data-testid={`bundle-form-component-sku-${key}`}>
                      {row.sku ?? ''}
                      {row.ean ? ` · EAN ${row.ean}` : ''}
                    </span>
                    {row.price !== null && parsed.qty > 0 ? (
                      <span className="bf-comp__value" data-testid={`bundle-form-component-value-${key}`}>
                        {interpolate(copy.lineValue, {
                          unit: format.money(row.price, row.currency ?? undefined),
                          qty: parsed.qty,
                          total: format.money(row.price * parsed.qty, row.currency ?? undefined),
                        })}
                      </span>
                    ) : null}
                    <span className={`bf-comp__stock${out ? ' is-out' : ''}`}>
                      {stock === null ? (
                        copy.stockUnknown
                      ) : out ? (
                        copy.stockOutSets
                      ) : (
                        <>
                          <b>{interpolate(copy.pcs, { n: stock })}</b>
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
                  <span className="bf-qty">
                    <button
                      type="button"
                      className="bf-qty__btn"
                      disabled={readOnly || (parsed.qty === 1 && !invalidQuantity)}
                      aria-label={interpolate(copy.qtyDec, { name: row.name })}
                      onClick={() => {
                        setQuantity(index, Math.max(1, parsed.qty - 1));
                      }}
                    >
                      {MINUS_GLYPH}
                    </button>
                    <Input
                      type="number"
                      min={1}
                      max={MAX_COMPONENT_QUANTITY}
                      step={1}
                      inputMode="numeric"
                      className="bf-qty__input"
                      aria-label={interpolate(copy.componentQuantity, { name: row.name })}
                      aria-describedby={message !== '' ? msgId : undefined}
                      data-testid={`bundle-form-component-qty-${key}`}
                      disabled={readOnly}
                      invalid={invalidQuantity}
                      {...form.register(`components.${index}.quantity`)}
                    />
                    <button
                      type="button"
                      className="bf-qty__btn"
                      disabled={readOnly || parsed.qty >= MAX_COMPONENT_QUANTITY}
                      aria-label={interpolate(copy.qtyInc, { name: row.name })}
                      onClick={() => {
                        setQuantity(index, Math.min(MAX_COMPONENT_QUANTITY, parsed.qty + 1));
                      }}
                    >
                      {PLUS_GLYPH}
                    </button>
                    <span className="bf-qty__unit">{copy.qtyUnit}</span>
                  </span>
                  <span className="bf-comp__tools">
                    <label className="ol-toggle bf-giftswitch" title={copy.giftToggleHelp}>
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
                    <button
                      type="button"
                      className="bf-trash"
                      disabled={readOnly}
                      title={readOnly ? copy.viewOnlyReason : interpolate(copy.removeFor, { name: row.name })}
                      aria-label={interpolate(copy.removeFor, { name: row.name })}
                      data-testid={`bundle-form-component-remove-${key}`}
                      onClick={() => {
                        removeRow(index, row);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </div>
                {row.gift ? <span hidden data-testid={`bundle-form-component-gift-${key}`} /> : null}
                <div className="bf-comp__msgwrap" data-open={message !== ''}>
                  <p
                    id={msgId}
                    className={`bf-comp__msg${invalidQuantity ? ' is-error' : ' is-warn'}`}
                    role={invalidQuantity ? 'alert' : undefined}
                  >
                    {message}
                  </p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {rows.length === 0 ? (
        <div className="cx-empty bf-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="bf-empty__ico">
            <path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4zM3.5 8 12 12m8.5-4L12 12m0 8v-8" />
          </svg>
          <p className="pm-empty__t">{copy.emptyTitle}</p>
          <p className="pm-empty__d">{copy.emptyHint}</p>
          <Button
            tone="secondary"
            className="button--sm"
            disabled={readOnly}
            data-testid="bundle-form-empty-search"
            onClick={() => {
              searchRef.current?.focus();
            }}
          >
            {copy.focusSearch}
          </Button>
        </div>
      ) : null}
      {showErrors && rows.length === 0 ? (
        <p className="pm-err" style={{ display: 'block' }}>
          {copy.emptyComponents}
        </p>
      ) : null}
    </div>
  );
}
