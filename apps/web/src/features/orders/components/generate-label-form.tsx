/**
 * Generate Label Form (#769)
 *
 * Inline expansion (NOT a modal) within `<OrderShipmentPanel>` for the AC-2
 * Generate-label flow. Pre-fills recipient + delivery-method-id + paczkomat-id
 * from `ParsedOrderSnapshot` (AC-3 — Allegro buyer-selected pickup point
 * pre-filled); operator types parcel dimensions + weight.
 *
 * Async-pending UX per plan §3.6: whole form is `<fieldset disabled>` during
 * mutation; submit button advertises the ~30s wait; after 5s an inline
 * status note + `aria-live="polite"` announces "Allegro is still processing".
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FieldError } from '../../../shared/ui/field-error';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { useToast } from '../../../shared/ui/toast-provider';
import { useId } from 'react';

import type { OrderRecord } from '../api/orders.types';
import {
  parseOrderSnapshot,
  type ParsedOrderSnapshot,
} from '../api/order-snapshot.schema';
import { useGenerateLabelMutation, type GenerateLabelInput } from '../../shipments';
import {
  generateLabelSchema,
  type GenerateLabelFormSubmission,
  type GenerateLabelFormValues,
} from './generate-label-form.schema';

interface GenerateLabelFormProps {
  /** The full order record — supplies recipient pre-fill + routing keys. */
  order: OrderRecord;
  /** Called after a successful submission so the parent can collapse the
   * inline expansion. */
  onSuccess: () => void;
  /** Called when the operator clicks Cancel to abort without submitting. */
  onCancel: () => void;
}

const SLOW_NOTICE_DELAY_MS = 5_000;

export function GenerateLabelForm({
  order,
  onSuccess,
  onCancel,
}: GenerateLabelFormProps): ReactElement {
  const snapshot = parseOrderSnapshot(order.orderSnapshot);
  const recipient = buildRecipientPreview(snapshot);
  const hasPickupPoint = snapshot.pickupPoint !== undefined;
  const shippingMethod: 'paczkomat' | 'kurier' = hasPickupPoint ? 'paczkomat' : 'kurier';

  const mutation = useGenerateLabelMutation();
  const { showToast } = useToast();

  const form = useForm<GenerateLabelFormValues, undefined, GenerateLabelFormSubmission>({
    defaultValues: {
      length: '' as unknown as number,
      width: '' as unknown as number,
      height: '' as unknown as number,
      weightGrams: '' as unknown as number,
      // Allegro flow: paczkomatId is pre-filled buyer-selected; InPost flow:
      // operator types (picker deferred per plan).
      paczkomatId: snapshot.pickupPoint?.id ?? '',
    },
    resolver: zodResolver(generateLabelSchema),
  });

  // Focus first input on mount (a11y — focus enters the inline expansion).
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const dimsBaseId = useId();
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Show the "Allegro is still processing" notice after 5s of pending.
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  useEffect(() => {
    if (!mutation.isPending) {
      setShowSlowNotice(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowNotice(true), SLOW_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mutation.isPending]);

  const onSubmit: SubmitHandler<GenerateLabelFormSubmission> = async (values) => {
    const input = buildGenerateLabelInput({ order, snapshot, values, shippingMethod });
    try {
      await mutation.mutateAsync(input);
      showToast({
        tone: 'success',
        title: 'Label generated',
        description: 'Tracking number will appear within ~5 minutes.',
      });
      form.reset();
      onSuccess();
    } catch {
      // Surfaced via `mutation.error` below.
    }
  };

  const validationMessages = collectValidationMessages(form.formState.errors);

  // Field labels (paczkomatId is operator-typed for InPost, pre-filled
  // read-only display for Allegro — distinguish copy via shippingMethod).
  const paczkomatIsBuyerSelected =
    shippingMethod === 'paczkomat' && hasPickupPoint;

  return (
    <form
      onSubmit={(e) => {
        void form.handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="generate-label-form"
      aria-labelledby="generate-label-form-heading"
    >
      <h4 id="generate-label-form-heading" className="generate-label-form__heading">
        Generate label
      </h4>

      {/* API error at top */}
      {mutation.error ? (
        <Alert tone="error" className="generate-label-form__error">
          {mutation.error.message}
        </Alert>
      ) : null}

      {/* Validation summary after first submit */}
      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}

      <fieldset disabled={mutation.isPending} className="generate-label-form__fieldset">
        {/* Recipient — reference display, never editable. */}
        <div className="generate-label-form__recipient">
          <p className="generate-label-form__section-label">Recipient</p>
          <KeyValueList items={recipient} />
        </div>

        {/* Dimensions composite (3 inputs in one labeled row). FormField only
            accepts a single control child, so render the composite directly
            against the same `.form-field` / `.form-field__label` markup the
            primitive uses. */}
        <div className="form-field">
          <label className="form-field__label" htmlFor={`${dimsBaseId}-length`}>
            Dimensions (mm)
          </label>
          <p className="form-field__description">Length × Width × Height</p>
          <div className="generate-label-form__dimensions">
            <Input
              {...form.register('length')}
              id={`${dimsBaseId}-length`}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="L"
              aria-label="Length in millimetres"
              ref={(el) => {
                form.register('length').ref(el);
                firstInputRef.current = el;
              }}
              invalid={Boolean(form.formState.errors.length)}
            />
            <Input
              {...form.register('width')}
              id={`${dimsBaseId}-width`}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="W"
              aria-label="Width in millimetres"
              invalid={Boolean(form.formState.errors.width)}
            />
            <Input
              {...form.register('height')}
              id={`${dimsBaseId}-height`}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="H"
              aria-label="Height in millimetres"
              invalid={Boolean(form.formState.errors.height)}
            />
          </div>
          <FieldError
            id={`${dimsBaseId}-error`}
            message={
              form.formState.errors.length?.message ??
              form.formState.errors.width?.message ??
              form.formState.errors.height?.message
            }
          />
        </div>

        <FormField
          label="Weight (g)"
          name="weightGrams"
          error={form.formState.errors.weightGrams?.message}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            {...form.register('weightGrams')}
            invalid={Boolean(form.formState.errors.weightGrams)}
          />
        </FormField>

        {shippingMethod === 'paczkomat' ? (
          <FormField
            label="Paczkomat"
            name="paczkomatId"
            description={
              paczkomatIsBuyerSelected
                ? 'Buyer-selected via Allegro — read-only.'
                : 'Type the paczkomat code (e.g. POZ08A). Picker coming in a follow-up.'
            }
            error={form.formState.errors.paczkomatId?.message}
          >
            <Input
              {...form.register('paczkomatId')}
              readOnly={paczkomatIsBuyerSelected}
              aria-readonly={paczkomatIsBuyerSelected ? 'true' : undefined}
              placeholder={paczkomatIsBuyerSelected ? undefined : 'POZ08A'}
            />
          </FormField>
        ) : null}

        {showSlowNotice ? (
          <div role="status" aria-live="polite" className="generate-label-form__slow-notice">
            Allegro is processing your label. This typically takes 10–30 seconds.
          </div>
        ) : null}
      </fieldset>

      <div className="generate-label-form__actions">
        <Button type="button" tone="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" tone="primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Generating label… (~30s)' : 'Generate label'}
        </Button>
      </div>
    </form>
  );
}

function buildRecipientPreview(snapshot: ParsedOrderSnapshot): KeyValueItem[] {
  const items: KeyValueItem[] = [];
  const a = snapshot.shippingAddress;

  const nameParts = [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim();
  if (nameParts) items.push({ id: 'name', label: 'Name', value: nameParts });
  if (snapshot.customerEmail) {
    items.push({ id: 'email', label: 'Email', value: snapshot.customerEmail, mono: true });
  }
  if (a?.phone) items.push({ id: 'phone', label: 'Phone', value: a.phone, mono: true });
  if (a) {
    const line1 = a.address1;
    const line2 = [a.postalCode, a.city, a.country].filter(Boolean).join(', ');
    items.push({ id: 'addr1', label: 'Street', value: line1 });
    items.push({ id: 'addr2', label: 'City', value: line2 });
  }
  if (snapshot.shipping?.methodName) {
    items.push({ id: 'method', label: 'Method', value: snapshot.shipping.methodName });
  }

  if (items.length === 0) {
    items.push({
      id: 'noPrefill',
      label: 'Recipient',
      value: 'Could not extract from order — operator must contact buyer.',
    });
  }

  return items;
}

function buildGenerateLabelInput(args: {
  order: OrderRecord;
  snapshot: ParsedOrderSnapshot;
  values: GenerateLabelFormSubmission;
  shippingMethod: 'paczkomat' | 'kurier';
}): GenerateLabelInput {
  const { order, snapshot, values, shippingMethod } = args;
  const a = snapshot.shippingAddress;

  // Address fields are required when the address sub-object is sent. Only
  // include the address block when we have the bare minimum (street + city
  // + country + postcode); otherwise the BE rejects it with class-validator
  // errors and the operator gets an actionable Alert.
  const address =
    a && a.address1 && a.city && a.postalCode && a.country
      ? {
          street: a.address1,
          buildingNumber: '—', // BE requires non-empty; address1 typically carries the building number too
          city: a.city,
          postCode: a.postalCode,
          countryCode: a.country.length === 2 ? a.country : a.country.slice(0, 2).toUpperCase(),
        }
      : undefined;

  return {
    sourceConnectionId: order.sourceConnectionId,
    sourceDeliveryMethodId: snapshot.shipping?.methodId ?? null,
    orderId: order.internalOrderId,
    shippingMethod,
    paczkomatId: values.paczkomatId && values.paczkomatId.length > 0 ? values.paczkomatId : undefined,
    recipient: {
      firstName: a?.firstName,
      lastName: a?.lastName,
      email: snapshot.customerEmail ?? '',
      phone: a?.phone ?? '',
      address,
    },
    parcel: {
      dimensions: { length: values.length, width: values.width, height: values.height },
      weightGrams: values.weightGrams,
    },
  };
}

function collectValidationMessages(
  errors: ReturnType<typeof useForm<GenerateLabelFormValues>>['formState']['errors'],
): string[] {
  const messages: string[] = [];
  for (const key of Object.keys(errors) as (keyof GenerateLabelFormValues)[]) {
    const message = errors[key]?.message;
    if (typeof message === 'string') messages.push(message);
  }
  return messages;
}
