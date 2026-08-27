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
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { EditConnectionFormValues } from './edit-connection.schema';
import {
  applyPricingRule,
  applyStockSafetyBuffer,
  type PriceRoundingMode,
  type PricingRule,
} from '../lib/stock-and-pricing-preview';

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

function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function StockAndPricingSection({
  form,
  configIsParseable,
  syncStockPolicyToJson,
  syncPricingRuleToJson,
}: StockAndPricingSectionProps): ReactElement {
  const stockErrors = form.formState.errors.stockPolicy;
  const priceErrors = form.formState.errors.pricingRule;

  // Local UI state, not derived per render: ticking a checkbox with the fields
  // still empty must keep them visible (see RateLimitSection for the trap).
  const [stockOpen, setStockOpen] = useState(
    form.getValues('stockPolicy.safetyBuffer') !== '' ||
      form.getValues('stockPolicy.zeroThreshold') !== '',
  );
  const [priceOpen, setPriceOpen] = useState(Boolean(form.getValues('pricingRule.type')));

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
      <h3 className="rate-limit-section__title">Stock and price on this destination</h3>
      <p className="rate-limit-section__help">
        By default this destination is told your catalogue quantity and your catalogue price,
        unchanged.
      </p>

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={stockOpen}
          disabled={!configIsParseable}
          onChange={(event) => handleStockOpenChange(event.target.checked)}
        />
        <span>Publish less stock than you hold</span>
      </label>

      {stockOpen ? (
        <>
          <p className="rate-limit-section__help">
            With <strong>{EXAMPLE_STOCK} units</strong> in your catalogue, this destination is told{' '}
            <strong>{examplePublishedStock}</strong>.
            {lowStockExample !== null && lowStockExample >= 1 ? (
              <>
                {' '}
                With <strong>{lowStockExample} units</strong> it is told <strong>0</strong>.
              </>
            ) : null}
          </p>

          <FormField
            label="Units to hold back"
            name="stockPolicy.safetyBuffer"
            error={stockErrors?.safetyBuffer?.message}
            description="Keeps a cushion so a fast-moving item cannot oversell between syncs. Leave blank or enter 0 to publish the full quantity."
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
            label="Stop selling below"
            name="stockPolicy.zeroThreshold"
            error={stockErrors?.zeroThreshold?.message}
            description="When the quantity to publish falls below this many units, publish 0 instead. Use it for slow-moving stock you would rather hold than risk. Leave blank or enter 0 to never stop early."
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

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={priceOpen}
          disabled={!configIsParseable}
          onChange={(event) => handlePriceOpenChange(event.target.checked)}
        />
        <span>Publish a different price than your catalogue</span>
      </label>

      {priceOpen ? (
        <>
          <p className="rate-limit-section__help">
            A catalogue price of <strong>{formatPrice(EXAMPLE_PRICE)}</strong> is published as{' '}
            <strong>{formatPrice(examplePublishedPrice)}</strong>. A price set on an individual
            item always wins and is never adjusted here.
          </p>

          <FormField
            label="How to set the price"
            name="pricingRule.type"
            error={priceErrors?.type?.message}
            description="A markup adds a percentage on top of your price. A margin sets the price so that the percentage you enter is the share of the final price you keep."
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
              <option value="passthrough">Use my catalogue price</option>
              <option value="markup">Add a markup</option>
              <option value="margin">Target a margin</option>
            </Select>
          </FormField>

          {ruleType === 'markup' || ruleType === 'margin' ? (
            <FormField
              label="Percentage"
              name="pricingRule.percent"
              error={priceErrors?.percent?.message}
              description={
                ruleType === 'margin'
                  ? 'Must be below 100. A margin of 100 or more has no answer, so it would be ignored and your catalogue price published instead.'
                  : 'Added on top of your catalogue price.'
              }
            >
              <Input
                value={percent}
                onChange={(event) => {
                  form.setValue('pricingRule.percent', event.target.value, { shouldDirty: true });
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
            label="Rounding"
            name="pricingRule.rounding"
            error={priceErrors?.rounding?.message}
            description="Applied after the percentage."
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
              <option value="none">Keep two decimal places</option>
              <option value="nearestWhole">Round to a whole number</option>
              <option value="endingIn99">End in .99</option>
            </Select>
          </FormField>
        </>
      ) : null}
    </section>
  );
}
