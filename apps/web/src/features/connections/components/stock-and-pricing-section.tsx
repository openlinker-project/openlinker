/**
 * StockAndPricingSection (#2610)
 *
 * Generic, platform-neutral editor for the two per-connection publish policies
 * that decide what a destination is told about stock and price -
 * `config.stockSafetyBuffer` + `config.stockZeroThreshold` (#1844 / #2610) and
 * `config.pricingRule` (#1843). Both were implemented and tested server-side
 * with no form field at all, so they protected and priced nothing.
 *
 * Rendered for EVERY connection, like `RateLimitSection` (#1810), whose shape
 * this follows: one checkbox opens each group, and nothing outside this
 * component may call `form.setValue` on these fields.
 *
 * Two design points.
 *
 * These are money and stock controls, so each group states its own effect on a
 * worked example rather than only accepting a number - the number alone does
 * not tell an operator that a 25% margin raises 100.00 to 133.33. The example
 * is computed by `stock-and-pricing-preview.ts`, a deliberate mirror of the
 * core helpers kept identical by `pnpm check:invariants` (the browser bundle
 * cannot import `@openlinker/core`, #591).
 *
 * A margin of 100% or more is refused by the Zod schema, not accepted and
 * silently degraded. The server falls back to the catalogue price there, so an
 * operator who typed 120 would save happily and publish an unchanged price.
 *
 * **Pricing-rule half retired for a viable pricing DESTINATION (#3149/#3166
 * review, ADR-072).** That population's `config.pricingRule` moved to the
 * nested `{default, sourceOverrides}` shape owned by the dedicated
 * `PricingAndSyncSection` page, and this section's own editable fields for
 * that same key are hidden behind `pricingRuleManagedElsewhere` — replaced by
 * a read-only pointer there — so the two can never disagree about the same
 * config key on one form. The stock-publish-policy half above is unaffected;
 * it has no rival editor.
 *
 * **Third group: stock-location override (#3206/#3207).** A per-connection
 * OPERATOR ASSERTION - "all of this connection's currently un-located stock
 * physically lives at this one location" - never a detection. Neither
 * PrestaShop nor WooCommerce can report where their stock physically is, so
 * without it the fulfilment router treats every position as unlocated and
 * skips it (ADR-058 decision 2, narrowed by #3206). The picker's options come
 * from `GET /inventory/locations` (the same read `/settings/inventory-locations`,
 * #3063, uses) via `useInventoryLocationsQuery` - EVERY status is listed
 * (retired locations included, labelled), mirroring `LocationDialog`'s
 * connection picker, because the currently-persisted value may since have
 * been retired and must still render with its real name rather than
 * vanishing from the select. Server-side existence/active-status validation
 * (`ConnectionService.validateStockLocationOverride`, #3206) is the only
 * place the id is actually checked; a 400 naming the field surfaces here as
 * a field-level error via `EditConnectionForm.onSubmit`'s `ApiError` mapping,
 * matched on the backend's machine-readable `error` code rather than on
 * message prose (`stock-location-override-error.ts`).
 *
 * **Gated on `InventoryMaster` (`stockLocationOverrideCapable`, #3207
 * review).** The stored config key is read by `MasterInventorySyncService`
 * only, so offering the group on a connection that can never use it would
 * both persist a value nothing reads (the configuration-that-decides-nothing
 * shape #2407 refuses) and spend an unconditional
 * `GET /inventory/locations` on every connection-edit page load for no
 * reason. The `GET` itself is skipped via `useInventoryLocationsQuery`'s
 * `enabled` option when the connection isn't capable.
 *
 * **Visibility does not depend on the read's outcome (#3207 review).** The
 * group renders whenever the form's `stockLocationOverride` field is
 * non-empty OR at least one `inventory_locations` row exists — never only
 * the latter. A stored value must survive a failed read, a still-loading
 * read, or a stored id that fell off the fetched page (deleted after the
 * override was set, or past `LOCATION_OPTIONS_PAGE_SIZE`); the alternative —
 * falling back to the empty placeholder — reads as "no override" while the
 * checkbox stays checked, and makes the specific stored id unrecoverable
 * from this surface. When the stored id isn't among the fetched rows, a
 * sentinel `<option>` names it explicitly, so the current state is stated
 * rather than silently dropped, and re-picking a real location is a genuine,
 * visible change rather than an invisible no-op.
 *
 * @module features/connections/components
 */
import { interpolate, renderRich, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { FormField } from '../../../shared/ui/form-field';
import { HelpLink } from '../../../shared/ui/help-link';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useInventoryLocationsQuery } from '../../inventory';
import type { EditConnectionFormValues } from './edit-connection.schema';
import {
  applyPricingRule,
  applyStockSafetyBuffer,
  type PriceRoundingMode,
  type PricingRule,
} from '../lib/stock-and-pricing-preview';

/**
 * One page is enough for a picker; an install with hundreds of warehouses is not this control's shape.
 * Must not exceed `ListLocationsQueryDto`'s `@Max(100)`, or every read is a 400 (#3634).
 */
const LOCATION_OPTIONS_PAGE_SIZE = 100;

/** Catalogue figures the worked examples are stated against. */
const EXAMPLE_STOCK = 10;
const EXAMPLE_PRICE = 100;

export interface StockAndPricingSectionProps {
  form: UseFormReturn<EditConnectionFormValues>;
  /** When false, raw JSON is unparseable - inputs are disabled (divergence gate). */
  configIsParseable: boolean;
  /** Host whole-object serializer; called AFTER setValue (ordering trap). */
  syncStockPolicyToJson: () => void;
  /** Host whole-object serializer for `config.pricingRule`. */
  syncPricingRuleToJson: () => void;
  /** Host serializer for the flat `config.stockLocationOverride` key (#3206/#3207). */
  syncStockLocationOverrideToJson: () => void;
  /**
   * True for a connection with the `InventoryMaster` capability enabled
   * (#3207 review). `config.stockLocationOverride` is read by
   * `MasterInventorySyncService` only, so offering the group on a connection
   * that cannot use it would persist a value nothing reads — the
   * configuration-that-decides-nothing shape #2407 refuses. Also gates the
   * `GET /inventory/locations` read behind `useInventoryLocationsQuery`'s
   * `enabled` option, so the group's cost is not paid by every connection.
   */
  stockLocationOverrideCapable: boolean;
  /**
   * True for a viable pricing DESTINATION (#3149/#3166 review) — that
   * population's `config.pricingRule` is now owned exclusively by the
   * dedicated `PricingAndSyncSection` page (nested `{default,
   * sourceOverrides}` shape, PATCHed through its own admin-gated,
   * lock-guarded endpoint). Two independent editors of the same key on one
   * mega-form produced a contradiction on first paint (this section's
   * checkbox reading the wrong sub-object), a destructive checkbox toggle
   * (unticking wrote `pricingRule: null`, dropping every per-source
   * override on save), and a stale-merge hazard on this form's own submit.
   * When true, the editable pricing-rule fields below are replaced by a
   * read-only pointer to that page instead — the stock-publish-policy half
   * is untouched, since it has no rival editor.
   */
  pricingRuleManagedElsewhere?: PricingRuleManagedElsewhere;
}

/**
 * Where the pricing rule is managed, when it is managed elsewhere.
 *
 * ABSENT means it is edited here. PRESENT means it is not, and carries the
 * destination — which is the only thing that makes the pointer useful. It was
 * a `boolean` plus a separate optional `href` whose docblock claimed the href
 * was "required when the flag is set" (#3166 round-3 review); the type did
 * not keep that promise, and the combination it allowed rendered the dead
 * plain-text string "Manage pricing & sync" with nowhere to go, which is
 * worse than either branch. One optional object makes that unrepresentable.
 */
export interface PricingRuleManagedElsewhere {
  href: string;
}

/**
 * Parse a digit-string knob. `''` (unset) and `'0'` are both "no effect" for
 * the example, but they are different persisted states - see the schema.
 */
function toUnits(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


export function StockAndPricingSection({
  form,
  configIsParseable,
  syncStockPolicyToJson,
  syncPricingRuleToJson,
  syncStockLocationOverrideToJson,
  stockLocationOverrideCapable,
  pricingRuleManagedElsewhere,
}: StockAndPricingSectionProps): ReactElement {
  const copy = useMessages('connections').stockAndPricingSection;
  const format = useFormat();
  const plural = usePlural();
  const formatPrice = (value: number): string =>
    format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const stockErrors = form.formState.errors.stockPolicy;
  const priceErrors = form.formState.errors.pricingRule;
  const locationOverrideError = form.formState.errors.stockLocationOverride;

  // Local UI state, not derived per render: ticking a checkbox with the fields
  // still empty must keep them visible (see RateLimitSection for the trap).
  const [stockOpen, setStockOpen] = useState(
    form.getValues('stockPolicy.safetyBuffer') !== '' ||
      form.getValues('stockPolicy.zeroThreshold') !== '',
  );
  const [priceOpen, setPriceOpen] = useState(Boolean(form.getValues('pricingRule.type')));
  const [locationOverrideOpen, setLocationOverrideOpen] = useState(
    Boolean(form.getValues('stockLocationOverride')),
  );

  // Every status, not just active — a location that has since been retired
  // must still render (with its real name) so the currently-stored override
  // doesn't silently vanish from the select. The gate below asks only "does
  // at least one row exist at all", not "is one active".
  //
  // `enabled: stockLocationOverrideCapable` (#3207 review) — no request at
  // all on a connection with no `InventoryMaster` capability, since nothing
  // reads the answer there.
  const locationsQuery = useInventoryLocationsQuery(
    undefined,
    { limit: LOCATION_OPTIONS_PAGE_SIZE },
    { enabled: stockLocationOverrideCapable },
  );
  const locations = locationsQuery.data?.items ?? [];
  const stockLocationOverride = form.watch('stockLocationOverride') ?? '';
  // A stored value is rendered REGARDLESS of the read's outcome (#3207
  // review finding) — a failed read, a loading state, or a stored id that
  // fell off the fetched page must never make an existing override silently
  // disappear from the form. `hasAnyLocation` alone covers the "nothing to
  // pick yet" case for a connection with no stored value.
  const hasAnyLocation = (locationsQuery.data?.total ?? 0) > 0;
  const shouldRenderLocationGroup =
    stockLocationOverrideCapable && (hasAnyLocation || stockLocationOverride !== '');
  // The stored id may not be among the fetched rows — deleted after the
  // override was set (architecture-overview.md § Inventory (#3206) names
  // this a deliberately unenforced standing degraded state), or past
  // `LOCATION_OPTIONS_PAGE_SIZE`, or simply not yet loaded/errored. Rather
  // than let `<Select>` silently resolve to the empty placeholder (which
  // would read as "no override" while the checkbox stays checked), a
  // sentinel option names the current state so re-picking a real location
  // is a genuine, visible change.
  const storedOverrideIsUnknown =
    stockLocationOverride !== '' && !locations.some((location) => location.id === stockLocationOverride);

  const safetyBuffer = form.watch('stockPolicy.safetyBuffer') ?? '';
  const zeroThreshold = form.watch('stockPolicy.zeroThreshold') ?? '';
  const ruleType = form.watch('pricingRule.type') ?? '';
  const percent = form.watch('pricingRule.percent') ?? '';
  const rounding = form.watch('pricingRule.rounding') ?? '';

  const reserveUnits = toUnits(safetyBuffer);
  const thresholdUnits = toUnits(zeroThreshold);
  const examplePublishedStock = applyStockSafetyBuffer(
    EXAMPLE_STOCK,
    reserveUnits,
    thresholdUnits,
  );

  // A fixed 10-unit example demonstrates nothing about a low floor: the floor
  // only shows up on a line that is actually low. This is the highest stock
  // level that still publishes 0, so the operator sees where the floor bites.
  const lowStockExample = thresholdUnits > 0 ? reserveUnits + thresholdUnits - 1 : null;

  const parsedPercent = percent === '' ? 0 : Number(percent);
  const previewRule: PricingRule | null =
    ruleType === ''
      ? null
      : {
          type: ruleType,
          percent: Number.isFinite(parsedPercent) ? parsedPercent : 0,
          rounding: (rounding === '' ? 'none' : rounding) as PriceRoundingMode,
        };
  const examplePublishedPrice = applyPricingRule(EXAMPLE_PRICE, previewRule);

  const handleLocationOverrideChange = (value: string): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize.
    form.setValue('stockLocationOverride', value, { shouldDirty: true });
    syncStockLocationOverrideToJson();
  };

  const handleLocationOverrideOpenChange = (checked: boolean): void => {
    setLocationOverrideOpen(checked);
    if (!checked) {
      form.setValue('stockLocationOverride', '', { shouldDirty: true });
    }
    syncStockLocationOverrideToJson();
  };

  const handleStockChange = (
    field: 'safetyBuffer' | 'zeroThreshold',
    value: string,
  ): void => {
    // ORDERING TRAP: write the form field FIRST, then re-serialize - the sync
    // function reads CURRENT form state via getValues.
    form.setValue(`stockPolicy.${field}`, value, { shouldDirty: true });
    syncStockPolicyToJson();
  };

  const handleStockOpenChange = (checked: boolean): void => {
    setStockOpen(checked);
    if (!checked) {
      form.setValue('stockPolicy.safetyBuffer', '', { shouldDirty: true });
      form.setValue('stockPolicy.zeroThreshold', '', { shouldDirty: true });
    }
    syncStockPolicyToJson();
  };

  const handlePriceOpenChange = (checked: boolean): void => {
    setPriceOpen(checked);
    if (!checked) {
      form.setValue('pricingRule.type', '', { shouldDirty: true });
      form.setValue('pricingRule.percent', '', { shouldDirty: true });
      form.setValue('pricingRule.rounding', '', { shouldDirty: true });
    } else if (!form.getValues('pricingRule.type')) {
      form.setValue('pricingRule.type', 'markup', { shouldDirty: true });
    }
    syncPricingRuleToJson();
  };

  return (
    <section className="rate-limit-section">
      <div className="section-title__with-help">
        <h3 className="rate-limit-section__title">{copy.title}</h3>
        <HelpLink surfaceKey="connection-stock-and-pricing" />
      </div>
      <p className="rate-limit-section__help">
        {copy.intro}
      </p>

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={stockOpen}
          disabled={!configIsParseable}
          onChange={(event) => handleStockOpenChange(event.target.checked)}
        />
        <span>{copy.stock.toggle}</span>
      </label>

      {stockOpen ? (
        <>
          <p className="rate-limit-section__help">
            {renderRich(
              plural(EXAMPLE_STOCK, copy.stock.example),
              strong,
              { n: format.number(EXAMPLE_STOCK), published: format.number(examplePublishedStock) },
            )}
            {lowStockExample !== null && lowStockExample >= 1 ? (
              <>
                {' '}
                {renderRich(plural(lowStockExample, copy.stock.lowExample), strong, {
                  n: format.number(lowStockExample),
                  zero: format.number(0),
                })}
              </>
            ) : null}
          </p>

          <FormField
            label={copy.stock.safetyBuffer.label}
            name="stockPolicy.safetyBuffer"
            error={stockErrors?.safetyBuffer?.message}
            description={copy.stock.safetyBuffer.description}
          >
            <Input
              value={safetyBuffer}
              onChange={(event) => handleStockChange('safetyBuffer', event.target.value)}
              disabled={!configIsParseable}
              placeholder="0"
              inputMode="numeric"
              invalid={Boolean(stockErrors?.safetyBuffer)}
            />
          </FormField>

          <FormField
            label={copy.stock.zeroThreshold.label}
            name="stockPolicy.zeroThreshold"
            error={stockErrors?.zeroThreshold?.message}
            description={copy.stock.zeroThreshold.description}
          >
            <Input
              value={zeroThreshold}
              onChange={(event) => handleStockChange('zeroThreshold', event.target.value)}
              disabled={!configIsParseable}
              placeholder="0"
              inputMode="numeric"
              invalid={Boolean(stockErrors?.zeroThreshold)}
            />
          </FormField>
        </>
      ) : null}

      {pricingRuleManagedElsewhere ? (
        <p className="rate-limit-section__help" id="pricing-rule-managed-elsewhere">
          {renderRich(copy.price.managedElsewhere, {
            link: (text) => <Link to={pricingRuleManagedElsewhere.href}>{text}</Link>,
          })}
        </p>
      ) : (
        <>
          <label className="rate-limit-section__toggle">
            <input
              type="checkbox"
              checked={priceOpen}
              disabled={!configIsParseable}
              onChange={(event) => handlePriceOpenChange(event.target.checked)}
            />
            <span>{copy.price.toggle}</span>
          </label>

          {priceOpen ? (
            <>
              <p className="rate-limit-section__help">
                {renderRich(copy.price.example, strong, {
                  price: formatPrice(EXAMPLE_PRICE),
                  published: formatPrice(examplePublishedPrice),
                })}
              </p>

              <FormField
                label={copy.price.type.label}
                name="pricingRule.type"
                error={priceErrors?.type?.message}
                description={copy.price.type.description}
              >
                <Select
                  value={ruleType}
                  disabled={!configIsParseable}
                  invalid={Boolean(priceErrors?.type)}
                  onChange={(event) => {
                    form.setValue(
                      'pricingRule.type',
                      event.target.value as '' | 'passthrough' | 'markup' | 'margin',
                      { shouldDirty: true },
                    );
                    syncPricingRuleToJson();
                  }}
                >
                  <option value="passthrough">{copy.price.type.options.passthrough}</option>
                  <option value="markup">{copy.price.type.options.markup}</option>
                  <option value="margin">{copy.price.type.options.margin}</option>
                </Select>
              </FormField>

              {ruleType === 'markup' || ruleType === 'margin' ? (
                <FormField
                  label={copy.price.percent.label}
                  name="pricingRule.percent"
                  error={priceErrors?.percent?.message}
                  description={
                    ruleType === 'margin'
                      ? copy.price.percent.marginHint
                      : copy.price.percent.markupHint
                  }
                >
                  <Input
                    value={percent}
                    onChange={(event) => {
                      form.setValue('pricingRule.percent', event.target.value, {
                        shouldDirty: true,
                      });
                      syncPricingRuleToJson();
                    }}
                    disabled={!configIsParseable}
                    placeholder="0"
                    inputMode="decimal"
                    invalid={Boolean(priceErrors?.percent)}
                  />
                </FormField>
              ) : null}

              <FormField
                label={copy.price.rounding.label}
                name="pricingRule.rounding"
                error={priceErrors?.rounding?.message}
                description={copy.price.rounding.description}
              >
                <Select
                  value={rounding === '' ? 'none' : rounding}
                  disabled={!configIsParseable}
                  invalid={Boolean(priceErrors?.rounding)}
                  onChange={(event) => {
                    form.setValue('pricingRule.rounding', event.target.value as PriceRoundingMode, {
                      shouldDirty: true,
                    });
                    syncPricingRuleToJson();
                  }}
                >
                  <option value="none">{copy.price.rounding.options.none}</option>
                  <option value="nearestWhole">{copy.price.rounding.options.nearestWhole}</option>
                  <option value="endingIn99">{copy.price.rounding.options.endingIn99}</option>
                </Select>
              </FormField>
            </>
          ) : null}
        </>
      )}

      {shouldRenderLocationGroup ? (
        <>
          <label className="rate-limit-section__toggle">
            <input
              type="checkbox"
              checked={locationOverrideOpen}
              disabled={!configIsParseable}
              onChange={(event) => handleLocationOverrideOpenChange(event.target.checked)}
            />
            <span>{copy.location.toggle}</span>
          </label>

          {locationOverrideOpen ? (
            <>
              <p className="rate-limit-section__help">
                {renderRich(copy.location.assertion, strong)}
              </p>

              {storedOverrideIsUnknown ? (
                <p className="rate-limit-section__help" role="status">
                  {locationsQuery.isLoading
                    ? copy.location.loading
                    : locationsQuery.isError
                      ? copy.location.loadError
                      : copy.location.unknownStored}
                </p>
              ) : null}

              <FormField
                label={copy.location.label}
                name="stockLocationOverride"
                /* eslint-disable-next-line no-restricted-syntax -- a form field error from the resolver, already translated */
                error={locationOverrideError?.message}
                description={copy.location.description}
              >
                <Select
                  value={stockLocationOverride}
                  disabled={!configIsParseable}
                  invalid={Boolean(locationOverrideError)}
                  onChange={(event) => handleLocationOverrideChange(event.target.value)}
                >
                  <option value="">{copy.location.placeholder}</option>
                  {storedOverrideIsUnknown ? (
                    <option value={stockLocationOverride}>
                      {interpolate(copy.location.currentlySet, { id: stockLocationOverride })}
                    </option>
                  ) : null}
                  {/* A non-active location is listed so a stored value keeps its real
                      name, but selecting a DIFFERENT retired one is a refusal the
                      server would answer with a 400 anyway — disable every non-active
                      option except whichever one is currently stored. */}
                  {locations.map((location) => (
                    <option
                      key={location.id}
                      value={location.id}
                      disabled={location.status !== 'active' && location.id !== stockLocationOverride}
                    >
                      {interpolate(
                        location.status !== 'active'
                          ? copy.location.optionInactive
                          : copy.location.option,
                        { name: location.name, code: location.code },
                      )}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
