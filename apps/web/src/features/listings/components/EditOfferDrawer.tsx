/**
 * EditOfferDrawer
 *
 * Side-panel drawer for editing Allegro offer fields (price, title, description).
 * Only modified (dirty) fields are sent in the API request.
 * Update is async (job-based) — no optimistic UI; shows a success toast and closes on 202.
 *
 * @module apps/web/src/features/listings/components
 */
import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { useUpdateOfferFields } from '../hooks/use-update-offer-fields';
import type { OfferMapping } from '../api/listings.types';
import type { UpdateOfferFieldsPayload } from '../api/listings.types';
import { editOfferFieldsSchema, type EditOfferFieldsValues } from './edit-offer-fields.schema';
import { OfferDescriptionEditor } from './OfferDescriptionEditor';

interface EditOfferDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  mapping: OfferMapping;
}

export function EditOfferDrawer({ isOpen, onClose, mapping }: EditOfferDrawerProps): ReactElement {
  const mutation = useUpdateOfferFields();
  const { showToast } = useToast();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const form = useForm<EditOfferFieldsValues>({
    defaultValues: {
      title: '',
      priceAmount: '',
      priceCurrency: 'PLN',
      descriptionText: '',
    },
    resolver: zodResolver(editOfferFieldsSchema),
  });

  // Stable reset callback — avoids including form/mutation in useEffect deps,
  // which would cause an infinite render loop (useMutation returns a new object every render).
  const resetDrawerState = useCallback(() => {
    closeButtonRef.current?.focus();
    form.reset();
    mutation.reset();
  }, [form, mutation]);

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
        title: 'Update dispatched',
        description: 'Changes will appear once the job completes.',
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
        aria-label="Edit offer"
        className="drawer"
      >
        <div className="drawer__header">
          <h2 className="drawer__title">Edit offer</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer__close"
            aria-label="Close drawer"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="drawer__body">
          {mutation.error ? (
            <Alert tone="error" title="Update failed">
              {mutation.error.message}
            </Alert>
          ) : null}

          <form
            id="edit-offer-fields-form"
            onSubmit={(e) => void onSubmit(e)}
            noValidate
          >
            <FormField
              label="Title"
              name="title"
              error={form.formState.errors.title?.message}
            >
              <Input
                {...form.register('title')}
                maxLength={75}
                placeholder="Offer title (max 75 characters)"
              />
            </FormField>

            <div className="form-grid form-grid--2col">
              <FormField
                label="Price"
                name="priceAmount"
                error={form.formState.errors.priceAmount?.message}
              >
                <Input
                  {...form.register('priceAmount')}
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 99.99"
                />
              </FormField>

              <FormField label="Currency" name="priceCurrency">
                <Input
                  {...form.register('priceCurrency')}
                  readOnly
                  className="input--readonly"
                  aria-label="Currency (read-only)"
                />
              </FormField>
            </div>

            <FormField
              label="Description"
              name="descriptionText"
              error={form.formState.errors.descriptionText?.message}
            >
              <OfferDescriptionEditor
                registration={form.register('descriptionText')}
                error={form.formState.errors.descriptionText?.message}
              />
            </FormField>
          </form>
        </div>

        <div className="drawer__footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-offer-fields-form"
            disabled={!isDirty || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </>
  );
}
