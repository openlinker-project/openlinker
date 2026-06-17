/**
 * Bulk Edit Modal (#740 step 4)
 *
 * Per-row override modal for the bulk listing wizard. Reuses the single-offer
 * wizard's `CategoryPicker`, `CategoryParametersStep`, and `SuggestionDialog`
 * (all already used inside the single-offer wizard, which itself nests inside
 * a Dialog — the "two-level Dialog focus management" concern from the plan's
 * §2 review was overstated).
 *
 * Saves into `BulkPerProductOverride` keyed by the row's variant ID.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useRef, type ReactElement } from 'react';
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Textarea,
} from '../../../../shared/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../shared/ui/dialog';
import { SuggestionDialog } from '../../../content';
import { CategoryPicker } from '../CategoryPicker';
import { CategoryParametersStep } from '../category-parameters-step';
import { useCategoryParametersQuery } from '../../hooks/use-category-parameters-query';
import {
  MissingCategoryParameterSectionError,
  categoryParametersToOfferParameters,
} from '../category-parameters-to-offer-parameters';
import type { CategoryParameter, OfferParameter } from '../../api/listings.types';
import type { CategoryParameterFormValues } from '../category-parameter-form.types';
import {
  makeBulkEditModalSchema,
  type BulkEditModalSubmission,
  type BulkEditModalValues,
} from './bulk-edit-modal.schema';
import type { BulkWizardRow } from './bulk-wizard.types';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';

interface BulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: BulkWizardRow;
  connectionId: string;
  /**
   * Whether the destination exposes a browsable category tree (`CategoryBrowser`,
   * #1096). True → the Allegro tree picker + category-parameter step. False → a
   * manual marketplace-category-id input and no parameter step, for a `borrows`
   * destination (Erli reuses the resolved Allegro id, ADR-025 §3; it has no
   * browsable tree and no product-section parameters).
   */
  canBrowseCategories: boolean;
  /**
   * Defaults applied to fields the operator hasn't overridden yet.
   * Pulled from the wizard's `sharedConfig` so the modal opens pre-filled.
   */
  defaults: {
    stock: number;
    publishImmediately: boolean;
    priceAmount: string;
    priceCurrency: string;
  };
  /**
   * Save handler — receives the new override block keyed by variant id and
   * the FE-only form-values stash. The wizard stores `editFormValues` on
   * the row so reopening the modal restores entered values; it never gets
   * forwarded to the bulk-create wire payload.
   */
  onSave: (
    variantId: string,
    override: BulkPerProductOverride,
    editFormValues: Record<string, unknown>,
  ) => void;
}

export function BulkEditModal({
  open,
  onOpenChange,
  row,
  connectionId,
  canBrowseCategories,
  defaults,
  onSave,
}: BulkEditModalProps): ReactElement | null {
  if (!row.primaryVariant) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <BulkEditModalForm
          row={row}
          connectionId={connectionId}
          canBrowseCategories={canBrowseCategories}
          defaults={defaults}
          onSave={onSave}
          onClose={() => { onOpenChange(false); }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface BulkEditModalFormProps {
  row: BulkWizardRow;
  connectionId: string;
  canBrowseCategories: boolean;
  defaults: BulkEditModalProps['defaults'];
  onSave: BulkEditModalProps['onSave'];
  onClose: () => void;
}

function BulkEditModalForm({
  row,
  connectionId,
  canBrowseCategories,
  defaults,
  onSave,
  onClose,
}: BulkEditModalFormProps): ReactElement {
  const variantId = row.primaryVariant?.id ?? '';

  // Snapshot the row's resolved values at modal-open time. `BulkEditModalForm`
  // mounts fresh on open (Radix Dialog portals its content), so a one-time ref
  // capture is the snapshot. A background availability refetch can mutate the
  // `row` prop while the modal is open; binding to this snapshot (and NOT
  // resetting the form on `row` changes) prevents it from clobbering the
  // operator's in-progress edits (#792).
  const initialValuesRef = useRef<BulkEditModalValues | null>(null);
  if (initialValuesRef.current === null) {
    const o = row.override.overrides ?? {};
    // Restore the operator's previously-entered parameter form values from
    // the row's FE-only stash, NOT from `platformParams` (the wire payload).
    const storedFormParameters =
      (row.editFormValues?.parameters as Record<string, unknown> | undefined) ?? {};
    initialValuesRef.current = {
      title: o.title ?? row.product?.name ?? '',
      categoryId: o.categoryId ?? row.resolvedCategoryId ?? '',
      productCardId: o.productCardId ?? '',
      description:
        typeof o.description === 'string' ? o.description : row.product?.description ?? '',
      stock: row.override.stock ?? defaults.stock,
      priceAmount:
        row.override.price !== undefined
          ? String(row.override.price.amount)
          : defaults.priceAmount,
      priceCurrency: (row.override.price?.currency ?? defaults.priceCurrency) as BulkEditModalValues['priceCurrency'],
      publishImmediately: row.override.publishImmediately ?? defaults.publishImmediately,
      parameters: storedFormParameters,
    };
  }
  const initialValues = initialValuesRef.current;

  const schema = useMemo(
    () => makeBulkEditModalSchema(canBrowseCategories),
    [canBrowseCategories],
  );
  const form = useForm<BulkEditModalValues, undefined, BulkEditModalSubmission>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  });

  // Watch categoryId so the parameters query refetches on category change.
  const watchedCategoryId = form.watch('categoryId');
  // Only a `CategoryBrowser` destination exposes per-category parameters; a
  // `borrows` destination (Erli) has none, so pass an empty id to keep the query
  // disabled (its `fetchCategoryParameters` would 422). (#1096)
  const parametersQuery = useCategoryParametersQuery(
    connectionId,
    canBrowseCategories &&
      typeof watchedCategoryId === 'string' &&
      watchedCategoryId.length > 0
      ? watchedCategoryId
      : '',
  );
  const categoryParameters: CategoryParameter[] = parametersQuery.data ?? [];

  const handleSubmit = form.handleSubmit((values) => {
    let parameters: OfferParameter[] = [];

    if (categoryParameters.length > 0 && values.parameters) {
      try {
        parameters = categoryParametersToOfferParameters(
          values.parameters as CategoryParameterFormValues,
          categoryParameters,
        );
      } catch (error) {
        if (error instanceof MissingCategoryParameterSectionError) {
          form.setError('categoryId', {
            type: 'manual',
            message:
              'Category parameter schema is stale. Close the wizard, reopen it, and try again.',
          });
          return;
        }
        throw error;
      }
    }

    const override: BulkPerProductOverride = {
      stock: values.stock,
      publishImmediately: values.publishImmediately,
      price: {
        amount: Number(values.priceAmount.replace(',', '.')),
        currency: values.priceCurrency,
      },
      overrides: {
        title: values.title,
        description: values.description,
        // A blank category (allowed for a `borrows` destination) is omitted so
        // the backend resolves it at submit (mapping / barcode), rather than
        // writing an empty override. (#1096)
        ...(values.categoryId ? { categoryId: values.categoryId } : {}),
        ...(values.productCardId ? { productCardId: values.productCardId } : {}),
        ...(parameters.length > 0 ? { parameters } : {}),
      },
    };

    // `values` is the FE-only form-values stash kept on the row so reopening
    // the modal restores entered values. Strictly separated from the wire
    // override above to avoid leaking RHF internals to the BE payload.
    onSave(variantId, override, values as unknown as Record<string, unknown>);
    onClose();
  });

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        noValidate
      >
        <DialogTitle>
          Edit offer — {row.product?.name ?? row.primaryVariant?.sku ?? variantId}
        </DialogTitle>
        <DialogDescription>
          Override per-row defaults. Unedited fields keep the values from the wizard's
          Config step.
        </DialogDescription>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            marginTop: 'var(--space-4)',
          }}
        >
          <FormField
            name="bulk-edit-title"
            label="Title"
            description="Max 75 characters (Allegro limit)."
            error={form.formState.errors.title?.message}
          >
            <Input
              {...form.register('title')}
              maxLength={75}
              aria-invalid={Boolean(form.formState.errors.title)}
            />
          </FormField>

          {row.categoryCandidates.length > 0 ? (
            <div className="bulk-edit__candidates">
              <span className="bulk-edit__candidates-label">
                Suggested categories (EAN matched several)
              </span>
              <div className="bulk-edit__candidate-chips">
                {row.categoryCandidates.map((candidate) => (
                  <button
                    key={candidate.allegroCategoryId}
                    type="button"
                    className="bulk-edit__candidate-chip"
                    onClick={() => {
                      // Link the candidate's card so Allegro inherits its
                      // required product params (#810, mirrors #808's unique-
                      // match path). Both move together.
                      form.setValue('categoryId', candidate.allegroCategoryId, {
                        shouldDirty: true,
                      });
                      form.setValue('productCardId', candidate.productCardId, {
                        shouldDirty: true,
                      });
                    }}
                  >
                    {candidate.name ?? candidate.allegroCategoryId}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {canBrowseCategories ? (
            <FormField
              name="bulk-edit-category"
              label="Allegro category"
              description="EAN auto-match prefilled this where possible."
              error={form.formState.errors.categoryId?.message}
            >
              <Controller
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <CategoryPicker
                    connectionId={connectionId}
                    value={field.value || null}
                    onChange={(id) => {
                      field.onChange(id);
                      // A manual category pick is not tied to a candidate card —
                      // drop any card so the offer doesn't link a card from a
                      // different category (#810). Re-clicking a candidate chip
                      // re-sets both.
                      form.setValue('productCardId', '', { shouldDirty: true });
                    }}
                    invalid={Boolean(form.formState.errors.categoryId)}
                  />
                )}
              />
            </FormField>
          ) : (
            // A `borrows` destination (Erli) has no browsable tree — the operator
            // supplies the resolved Allegro category id directly (taxonomy reuse,
            // ADR-025 §3). Left blank, the category is resolved server-side at
            // submit (override → barcode → configured category mapping). (#1096)
            <FormField
              name="bulk-edit-category"
              label="Allegro category ID"
              description="Reuses the resolved Allegro category id. Leave blank to resolve from your configured category mappings at submit."
              error={form.formState.errors.categoryId?.message}
            >
              <Input
                {...form.register('categoryId')}
                placeholder="e.g. 12345"
                inputMode="numeric"
                aria-invalid={Boolean(form.formState.errors.categoryId)}
              />
            </FormField>
          )}

          <DescriptionField productId={row.product?.id ?? ''} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-3)',
            }}
          >
            <FormField
              name="bulk-edit-stock"
              label="Stock"
              error={form.formState.errors.stock?.message}
            >
              <Input
                type="number"
                min={0}
                {...form.register('stock', { valueAsNumber: true })}
                aria-invalid={Boolean(form.formState.errors.stock)}
              />
            </FormField>
            <FormField
              name="bulk-edit-price"
              label="Price"
              error={form.formState.errors.priceAmount?.message}
            >
              <Input
                {...form.register('priceAmount')}
                placeholder="79.00"
                aria-invalid={Boolean(form.formState.errors.priceAmount)}
              />
            </FormField>
            <FormField name="bulk-edit-currency" label="Currency">
              <Select {...form.register('priceCurrency')}>
                <option value="PLN">PLN</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CZK">CZK</option>
              </Select>
            </FormField>
          </div>

          <label
            className="checkbox-row"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}
          >
            <input type="checkbox" {...form.register('publishImmediately')} />
            <span>
              <strong>Publish immediately</strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                Uncheck to create as draft for this row only.
              </small>
            </span>
          </label>

          {canBrowseCategories ? (
            <ParameterSection
              watchedCategoryId={watchedCategoryId}
              parametersQuery={parametersQuery}
              categoryParameters={categoryParameters}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button tone="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" type="submit">
            Save row
          </Button>
        </DialogFooter>
      </form>
    </FormProvider>
  );
}

function DescriptionField({ productId }: { productId: string }): ReactElement {
  const form = useFormContext<BulkEditModalValues>();
  const error = form.formState.errors.description?.message;

  return (
    <div>
      <div className="bulk-edit__desc-row" style={{ marginBottom: 'var(--space-2)' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Plain text — Allegro's rich-text editor is out of scope for the bulk wizard.
        </span>
        {productId !== '' ? (
          <SuggestionDialog
            productId={productId}
            channel="allegro"
            onApply={(suggestion) => {
              form.setValue('description', suggestion, { shouldDirty: true });
            }}
          />
        ) : null}
      </div>
      <FormField name="bulk-edit-description" label="Description" error={error}>
        <Textarea
          {...form.register('description')}
          rows={6}
          aria-invalid={Boolean(error)}
        />
      </FormField>
    </div>
  );
}

interface ParameterSectionProps {
  watchedCategoryId: string | undefined;
  parametersQuery: ReturnType<typeof useCategoryParametersQuery>;
  categoryParameters: CategoryParameter[];
}

function ParameterSection({
  watchedCategoryId,
  parametersQuery,
  categoryParameters,
}: ParameterSectionProps): ReactElement | null {
  if (!watchedCategoryId) return null;
  if (parametersQuery.isLoading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        Loading category parameters…
      </div>
    );
  }
  if (parametersQuery.error) {
    return (
      <Alert tone="warning">
        Could not load category parameters. You can still save the row — the worker may
        reject if required params are missing.
      </Alert>
    );
  }
  if (categoryParameters.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        No category parameters required for this category.
      </div>
    );
  }
  // Suppress unused — useWatch is wired via the inner step's own
  // FormProvider context.
  void watchedCategoryId;
  return (
    <div>
      <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 'var(--space-2)' }}>
        Category parameters
      </div>
      <CategoryParametersStep parameters={categoryParameters} formNamespace="parameters" />
    </div>
  );
}
