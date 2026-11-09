/**
 * EditOfferDrawer
 *
 * Side-panel drawer for editing Allegro offer fields (price, title, description).
 * Only modified (dirty) fields are sent in the API request.
 * Update is async (job-based) — no optimistic UI; shows a success toast and closes on 202.
 *
 * @module apps/web/src/features/listings/components
 */
import { type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { exceedsDescriptionCap } from '../../../shared/ui';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { useUpdateOfferFields } from '../hooks/use-update-offer-fields';
import { useDescriptionFormatQuery } from '../hooks/use-description-format-query';
import type { OfferMapping } from '../api/listings.types';
import type { UpdateOfferFieldsPayload } from '../api/listings.types';
import {
  createEditOfferFieldsSchema,
  EDIT_OFFER_TITLE_MAX_LENGTH,
  type EditOfferFieldsValues,
} from './edit-offer-fields.schema';
import { OfferDescriptionEditor } from './offer-description-editor';
import { SuggestionDialog } from '../../content';
import { serverErrorText } from '../lib/server-error-text';

interface EditOfferDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  mapping: OfferMapping;
}

export function EditOfferDrawer({ isOpen, onClose, mapping }: EditOfferDrawerProps): ReactElement {
  const mutation = useUpdateOfferFields();
  const { showToast } = useToast();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const copy = useMessages('listings').editOfferDrawer;
  const common = useMessages('listings').common;
  const format = useFormat();
  const schema = useMemo(() => createEditOfferFieldsSchema(copy.validation), [copy.validation]);

  const form = useForm<EditOfferFieldsValues>({
    defaultValues: {
      title: '',
      priceAmount: '',
      priceCurrency: 'PLN',
      descriptionText: '',
    },
    resolver: zodResolver(schema),
  });

  // #478: depend on the destructured stable `reset` methods, not the
  // wrapping `form` / `mutation` objects — `useMutation` returns a fresh
  // wrapper each render, which would churn this callback's identity and
  // re-fire the consuming effect (the `prevIsOpenRef` guard masks it here).
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  const resetDrawerState = useCallback(() => {
    closeButtonRef.current?.focus();
    resetForm();
    resetMutation();
  }, [resetForm, resetMutation]);

  // Reset form and mutation state each time the drawer opens
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      resetDrawerState();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, resetDrawerState]);

  const { dirtyFields } = form.formState;
  const isDirty = Object.keys(dirtyFields).length > 0;

  const linkedProductId = mapping.linkedProductId ?? null;
  // Channel is the mapping's platformType verbatim (open-world per #580).
  // The BE falls back to the master template when no channel-specific row
  // is published, so suggestion always works for any registered platform.
  const suggestChannel = mapping.platformType;
  const canSuggest = linkedProductId !== null;
  const disabledHint =
    linkedProductId === null
      ? copy.suggestionNeedsVariant
      : null;

  const { setValue: setFormValue } = form;
  const handleApplySuggestion = useCallback(
    (suggestion: string) => {
      setFormValue('descriptionText', suggestion, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [setFormValue],
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  // ADR-046: the destination's own byte cap, enforced before dispatch. The
  // counter under the editor only informs; the update is a job, so an over-cap
  // description would be accepted here and rejected by the platform long after
  // the drawer closed. Same read the editor composes itself from (one query,
  // deduped by key), so the number quoted below is the destination's.
  const descriptionFormat = useDescriptionFormatQuery(mapping.connectionId).data ?? null;
  const descriptionValue = form.watch('descriptionText') ?? '';
  const overDescriptionCap = exceedsDescriptionCap(descriptionValue, descriptionFormat);

  const onSubmit = form.handleSubmit(async (values) => {
    const fields: UpdateOfferFieldsPayload = {};

    if (dirtyFields.title && values.title) {
      fields.title = values.title;
    }

    if (dirtyFields.priceAmount && values.priceAmount) {
      fields.price = {
        amount: values.priceAmount,
        currency: values.priceCurrency ?? 'PLN',
      };
    }

    if (dirtyFields.descriptionText && values.descriptionText) {
      fields.description = {
        sections: [{ items: [{ type: 'TEXT', content: values.descriptionText }] }],
      };
    }

    if (Object.keys(fields).length === 0) {
      return;
    }

    try {
      await mutation.mutateAsync({
        connectionId: mapping.connectionId,
        offerId: mapping.internalId,
        fields,
      });
      showToast({
        tone: 'success',
        title: copy.toasts.dispatchedTitle,
        description: copy.toasts.dispatchedDescription,
      });
      onClose();
    } catch {
      // Error displayed inline via mutation.error
    }
  });

  if (!isOpen) {
    return <></>;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        className="drawer"
      >
        <div className="drawer__header">
          <h2 className="drawer__title">{copy.title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer__close"
            aria-label={copy.closeAriaLabel}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="drawer__body">
          {mutation.error ? (
            <Alert tone="error" title={copy.updateFailed}>
              {serverErrorText(common.serverSaid, mutation.error.message, common.unknownError)}
            </Alert>
          ) : null}

          {overDescriptionCap && descriptionFormat?.maxBytes != null ? (
            <Alert tone="warning">
              {interpolate(copy.overDescriptionCap, {
                maxBytes: format.number(descriptionFormat.maxBytes),
              })}
            </Alert>
          ) : null}

          <form
            id="edit-offer-fields-form"
            onSubmit={(e) => void onSubmit(e)}
            noValidate
          >
            {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
              <FormErrorSummary errors={validationMessages} />
            ) : null}
            <FormField
              label={copy.fields.title}
              name="title"
              error={form.formState.errors.title?.message}
            >
              <Input
                {...form.register('title')}
                maxLength={EDIT_OFFER_TITLE_MAX_LENGTH}
                placeholder={copy.fields.titlePlaceholder}
              />
            </FormField>

            <div className="form-grid form-grid--2col">
              <FormField
                label={copy.fields.price}
                name="priceAmount"
                error={form.formState.errors.priceAmount?.message}
              >
                <Input
                  {...form.register('priceAmount')}
                  type="text"
                  inputMode="decimal"
                  placeholder={copy.fields.pricePlaceholder}
                />
              </FormField>

              <FormField label={copy.fields.currency} name="priceCurrency">
                <Input
                  {...form.register('priceCurrency')}
                  readOnly
                  className="input--readonly"
                  aria-label={copy.fields.currencyReadOnly}
                />
              </FormField>
            </div>

            <div className="edit-offer-drawer__description">
              {canSuggest || disabledHint ? (
                <div className="edit-offer-drawer__description-actions">
                  {canSuggest && linkedProductId !== null ? (
                    <SuggestionDialog
                      productId={linkedProductId}
                      channel={suggestChannel}
                      disabled={mutation.isPending}
                      onApply={handleApplySuggestion}
                      scopeWarning={renderRich(copy.suggestionScopeWarning, {
                        strong: (text) => <strong>{text}</strong>,
                      })}
                    />
                  ) : (
                    <span
                      className="edit-offer-drawer__description-hint"
                      aria-live="polite"
                    >
                      {disabledHint}
                    </span>
                  )}
                </div>
              ) : null}

              <FormField
                label={copy.fields.description}
                name="descriptionText"
                error={form.formState.errors.descriptionText?.message}
              >
                {/* ADR-046: rich text, with the toolbar and schema derived from
                    this offer's own destination. Bound through watch/setValue
                    rather than `register` because the editor is a custom control,
                    not a native input. */}
                <OfferDescriptionEditor
                  connectionId={mapping.connectionId}
                  value={form.watch('descriptionText') ?? ''}
                  onChange={(html) => {
                    form.setValue('descriptionText', html, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  error={form.formState.errors.descriptionText?.message}
                />
              </FormField>
            </div>
          </form>
        </div>

        <div className="drawer__footer">
          <Button type="button" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            type="submit"
            form="edit-offer-fields-form"
            disabled={!isDirty || mutation.isPending || overDescriptionCap}
          >
            {mutation.isPending ? copy.saving : copy.save}
          </Button>
        </div>
      </div>
    </>
  );
}
