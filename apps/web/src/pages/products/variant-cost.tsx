/**
 * Variant cost (#3588, M26)
 *
 * The net (VAT-exclusive) unit cost of a variant on the product page: the
 * "Cost (net)" cell shown in every rendering of the variants list, and the
 * "Cost price" drawer section with its edit form.
 *
 * Cost is entered in OpenLinker and never written by the master sync, which is
 * why the section says so. `null` is "not recorded" and is NEVER drawn as
 * zero; `0.00` is a real cost.
 *
 * Editing needs `products:write` (admin only). A user without it sees the value
 * and a DISABLED "Edit cost" with the reason, never a hidden control.
 *
 * @module apps/web/src/pages/products
 */
import { useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ProductVariant, VariantCost } from '../../features/products/api/products.types';
import { useVariantCostsQuery } from '../../features/products/hooks/use-variant-costs-query';
import { useSetVariantCostMutation } from '../../features/products/hooks/use-set-variant-cost-mutation';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { usePermission } from '../../shared/auth/use-permission';

const COST_ERROR_COPY =
  'Enter a cost of 0 or more, with up to 2 decimals. Leave the field empty if you do not know it yet.';
const READ_ONLY_REASON = 'Only an admin can change cost prices.';
const FALLBACK_CURRENCIES = ['PLN', 'EUR', 'CZK'] as const;

/** Same slug the photo testids use, so one variant has one slug everywhere. */
function variantSlug(variant: ProductVariant): string {
  return (variant.sku ?? variant.id).toLowerCase();
}

/**
 * `"22.8000"` -> `"22.80"`: at least two decimals, and more only when the
 * stored cost genuinely carries them (the column holds four).
 */
export function formatCostAmount(netUnitCost: string): string {
  const [whole, fraction = ''] = netUnitCost.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}.${trimmed.padEnd(2, '0')}`;
}

function formatCost(cost: VariantCost): string {
  return `${cost.costCurrency ?? ''} ${formatCostAmount(cost.netUnitCost ?? '0')}`.trim();
}

function hasCost(cost: VariantCost | undefined): cost is VariantCost {
  return cost !== undefined && cost.netUnitCost !== null;
}

function useVariantCost(variant: ProductVariant): {
  cost: VariantCost | undefined;
  isKnown: boolean;
} {
  const query = useVariantCostsQuery(variant.productId);
  const rows = Array.isArray(query.data) ? query.data : undefined;
  return {
    cost: rows?.find((row) => row.variantId === variant.id),
    isKnown: rows !== undefined,
  };
}

/** The "Cost (net)" table / card cell. */
export function VariantCostCell({ variant }: { variant: ProductVariant }): ReactElement {
  const { cost, isKnown } = useVariantCost(variant);
  const testId = `variant-cost-cell-${variantSlug(variant)}`;

  if (!isKnown) {
    return (
      <span className="text-muted" data-testid={testId}>
        —
      </span>
    );
  }
  if (!hasCost(cost)) {
    return (
      <span data-testid={testId}>
        <StatusBadge tone="warning" withDot compact>
          Not recorded
        </StatusBadge>
      </span>
    );
  }
  return (
    <span className="mono-text tabular" data-testid={testId}>
      {formatCost(cost)}
    </span>
  );
}

const costFormSchema = z.object({
  amount: z
    .string()
    .transform((value) => value.trim().replace(',', '.'))
    .refine((value) => value === '' || /^\d{1,8}(\.\d{1,2})?$/.test(value), COST_ERROR_COPY),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

type CostFormInput = z.input<typeof costFormSchema>;
type CostFormValues = z.output<typeof costFormSchema>;

function currencyOptions(productCurrency: string | null, current: string | null): string[] {
  return Array.from(
    new Set([productCurrency, current, ...FALLBACK_CURRENCIES].filter((c): c is string => Boolean(c)))
  );
}

function VariantCostForm({
  variant,
  productCurrency,
  initial,
  onDone,
}: {
  variant: ProductVariant;
  productCurrency: string | null;
  initial: VariantCost | undefined;
  onDone: () => void;
}): ReactElement {
  const slug = variantSlug(variant);
  const mutation = useSetVariantCostMutation(variant.productId);
  const options = currencyOptions(productCurrency, initial?.costCurrency ?? null);
  const form = useForm<CostFormInput, undefined, CostFormValues>({
    resolver: zodResolver(costFormSchema),
    defaultValues: {
      amount: hasCost(initial) ? formatCostAmount(initial.netUnitCost ?? '') : '',
      currency: initial?.costCurrency ?? productCurrency ?? options[0] ?? 'PLN',
    },
  });
  const amountError = form.formState.errors.amount?.message;

  const submit = form.handleSubmit((values) => {
    // An empty field means "I do not know it yet": nothing to save, so it
    // behaves like Cancel rather than silently clearing an existing cost.
    if (values.amount === '') {
      onDone();
      return;
    }
    mutation.mutate(
      { variantId: variant.id, input: { netUnitCost: values.amount, currency: values.currency } },
      { onSuccess: onDone }
    );
  });

  return (
    <form
      className="variant-cost__form"
      data-testid={`variant-cost-form-${slug}`}
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label className="form-field__label" htmlFor={`variant-cost-input-${slug}`}>
        Cost price, net per unit
      </label>
      <div className="variant-cost__row">
        <div className={`field__price-input${amountError ? ' has-error' : ''}`}>
          <Input
            id={`variant-cost-input-${slug}`}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={amountError ? true : undefined}
            aria-describedby={`variant-cost-desc-${slug} variant-cost-error-${slug}`}
            data-testid="variant-cost-input"
            {...form.register('amount')}
          />
          <span className="field__currency">net</span>
        </div>
        <Select
          aria-label="Cost currency"
          data-testid="variant-cost-currency"
          {...form.register('currency')}
        >
          {options.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      </div>
      <p className="form-field__description" id={`variant-cost-desc-${slug}`}>
        What you pay for one unit, excluding VAT. Used for margin on orders placed from now on;
        earlier orders keep no cost.
      </p>
      <p
        className="form-field__error"
        id={`variant-cost-error-${slug}`}
        role="alert"
        data-testid="variant-cost-error"
        hidden={!amountError}
      >
        {amountError ?? COST_ERROR_COPY}
      </p>
      {mutation.isError ? (
        <p className="form-field__error" role="alert">
          {mutation.error.message || 'The cost could not be saved.'}
        </p>
      ) : null}
      <div className="variant-cost__actions">
        <Button type="submit" className="button--sm" disabled={mutation.isPending} data-testid="variant-cost-save">
          Save cost
        </Button>
        <Button
          type="button"
          tone="ghost"
          className="button--sm"
          onClick={onDone}
          data-testid="variant-cost-cancel"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The "Cost price" drawer section. */
export function VariantCostSection({
  variant,
  productCurrency,
  sourceName,
}: {
  variant: ProductVariant;
  productCurrency: string | null;
  sourceName?: string | null;
}): ReactElement {
  const slug = variantSlug(variant);
  const canEdit = usePermission('products:write');
  const { cost, isKnown } = useVariantCost(variant);
  const clearMutation = useSetVariantCostMutation(variant.productId);
  const [editing, setEditing] = useState(false);
  const recorded = hasCost(cost);
  const readOnlyReasonId = `variant-cost-ro-${slug}`;

  let body: ReactElement;
  if (!isKnown) {
    body = <p className="variant-drawer__meta-muted">Cost is not available right now.</p>;
  } else if (editing && canEdit) {
    body = (
      <VariantCostForm
        variant={variant}
        productCurrency={productCurrency}
        initial={cost}
        onDone={() => setEditing(false)}
      />
    );
  } else {
    body = (
      <>
        {recorded ? (
          <>
            <div className="variant-cost__value" data-testid={`variant-cost-value-${slug}`}>
              {formatCost(cost)} <span className="variant-cost__unit">net per unit</span>
            </div>
            <div className="variant-cost__provenance" data-testid={`variant-cost-provenance-${slug}`}>
              <StatusBadge tone="info" withDot compact>
                Entered in OpenLinker
              </StatusBadge>
              {cost.costUpdatedAt ? (
                <span>
                  · <TimeDisplay iso={cost.costUpdatedAt} />
                </span>
              ) : null}
            </div>
            <p className="variant-cost__hint">
              {sourceName
                ? `The ${sourceName} sync never changes or clears this value.`
                : 'The master sync never changes or clears this value.'}
            </p>
          </>
        ) : (
          <p className="variant-cost__missing">
            No cost recorded. Orders for this variant are left out of margin.
          </p>
        )}
        <div className="variant-cost__actions">
          {canEdit ? (
            <>
              {recorded ? (
                <>
                  <Button
                    type="button"
                    tone="secondary"
                    className="button--sm"
                    onClick={() => setEditing(true)}
                    data-testid={`variant-cost-edit-${slug}`}
                  >
                    Edit cost
                  </Button>
                  <Button
                    type="button"
                    tone="ghost"
                    className="button--sm"
                    disabled={clearMutation.isPending}
                    onClick={() =>
                      clearMutation.mutate({
                        variantId: variant.id,
                        input: { netUnitCost: null, currency: null },
                      })
                    }
                    data-testid={`variant-cost-clear-${slug}`}
                  >
                    Clear cost
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  tone="secondary"
                  className="button--sm"
                  onClick={() => setEditing(true)}
                  data-testid={`variant-cost-add-${slug}`}
                >
                  Add cost
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              disabled
              aria-describedby={readOnlyReasonId}
              data-testid={`variant-cost-edit-${slug}`}
            >
              Edit cost
            </Button>
          )}
        </div>
        {canEdit && recorded ? (
          <p className="variant-cost__hint">Clearing a cost affects orders placed from now on only.</p>
        ) : null}
        {clearMutation.isError ? (
          <p className="form-field__error" role="alert">
            {clearMutation.error.message || 'The cost could not be cleared.'}
          </p>
        ) : null}
        {!canEdit ? (
          <p className="variant-cost__hint" id={readOnlyReasonId} data-testid="variant-cost-readonly-reason">
            {READ_ONLY_REASON}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="variant-drawer__cost">
      <div className="variant-drawer__label">Cost price</div>
      {body}
    </div>
  );
}
