/**
 * Generate Label Form (#769)
 *
 * Inline expansion (NOT a modal) within `<OrderShipmentPanel>` for the AC-2
 * Generate-label flow. Pre-fills recipient + delivery-method-id + paczkomat-id
 * from `ParsedOrderSnapshot` (AC-3 — Allegro buyer-selected pickup point
 * pre-filled); operator types parcel dimensions + weight.
 *
 * **Pre-flight discipline (tech-review BLOCKING fix)** — the form has no
 * editable recipient inputs in v1. If the snapshot is missing fields the BE
 * requires, submit is disabled and an Alert lists what's missing so the
 * operator can fix it at the source (re-poll the order, update the buyer in
 * the source platform, etc.) instead of bouncing off a 400. The paczkomat
 * flow doesn't need a shipping address (the parcel goes to the locker), so
 * we skip the address block entirely for paczkomat regardless of snapshot
 * completeness.
 *
 * Async-pending UX per plan §3.6: whole form is `<fieldset disabled>` during
 * mutation; submit button advertises the ~30s wait; after 5s an inline
 * status note + `aria-live="polite"` announces "Allegro is still processing".
 *
 * @module apps/web/src/features/orders/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';

import { useConnectionsQuery } from '../../connections';
import { usePlatform } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FieldError } from '../../../shared/ui/field-error';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';

import type { OrderRecord } from '../api/orders.types';
import {
  parseOrderSnapshot,
  type ParsedOrderSnapshot,
} from '../api/order-snapshot.schema';
import { ordersQueryKeys } from '../api/orders.query-keys';
import {
  useGenerateLabelMutation,
  useLabelDownload,
  type GenerateLabelInput,
} from '../../shipments';
import {
  COD_CURRENCY_VALUES,
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

/**
 * Window during which a missing Allegro pickup-point is considered "still
 * arriving" rather than "absent" (#839 AC-3). Allegro Delivery resolves the
 * buyer's locker asynchronously — the order arrives before the
 * pickup-point payload — so for Allegro-source orders younger than this
 * window we render a retry hint instead of silently falling through to
 * the kurier flow.
 */
const PICKUP_POINT_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

function isWithinPickupPointRetryWindow(createdAtIso: string): boolean {
  const createdAt = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt < PICKUP_POINT_RETRY_WINDOW_MS;
}

/**
 * Locker-method keyword tokens (#954). A delivery method whose name/id matches
 * resolves to a pickup point (paczkomat / parcel locker), not a courier
 * doorstep delivery. Heuristic until the snapshot carries the method
 * authoritatively (#952 populates `shipping.methodId`/`methodName`); a
 * platform-provided locker flag is the longer-term replacement.
 */
const LOCKER_METHOD_RE = /paczkomat|locker|automat|punkt|pickup|one\s*box|one\s*punkt/i;

/**
 * Classify the buyer's source delivery method as a locker (pickup-point) or
 * courier shipment. Returns `'unknown'` when the snapshot doesn't carry the
 * method yet (pre-#952) — callers fall back to other signals.
 */
function classifyDeliveryMethod(
  shipping: ParsedOrderSnapshot['shipping'],
): 'locker' | 'courier' | 'unknown' {
  if (!shipping) return 'unknown';
  const haystack = `${shipping.methodName ?? ''} ${shipping.methodId}`;
  return LOCKER_METHOD_RE.test(haystack) ? 'locker' : 'courier';
}

export function GenerateLabelForm({
  order,
  onSuccess,
  onCancel,
}: GenerateLabelFormProps): ReactElement {
  const snapshot = parseOrderSnapshot(order.orderSnapshot);
  const recipient = buildRecipientPreview(snapshot);
  const hasPickupPoint = snapshot.pickupPoint !== undefined;
  // Locker-vs-courier is driven by the actual delivery method (#954), not by
  // `pickupPoint` presence alone (which was circular). A resolved pickup point
  // or a locker-classified method ⇒ paczkomat flow.
  const methodClass = classifyDeliveryMethod(snapshot.shipping);
  const shippingMethod: 'paczkomat' | 'kurier' =
    hasPickupPoint || methodClass === 'locker' ? 'paczkomat' : 'kurier';
  // Clear courier signal: the method is known-courier, or — until the snapshot
  // carries the method (#952) — the order has a full street address but no
  // pickup point. Suppresses the locker retry hint on courier orders that will
  // never have a pickup point, while preserving it for likely-locker orders
  // (no street address yet) per #839/#893.
  const hasFullStreetAddress = Boolean(
    snapshot.shippingAddress?.address1 &&
      snapshot.shippingAddress?.city &&
      snapshot.shippingAddress?.postalCode,
  );
  const isLikelyCourier =
    methodClass === 'courier' || (methodClass === 'unknown' && hasFullStreetAddress);
  const missingFields = useMemo(
    () => detectMissingFields(snapshot, shippingMethod),
    [snapshot, shippingMethod],
  );

  const mutation = useGenerateLabelMutation();
  const labelDownload = useLabelDownload();
  const { showToast } = useToast();

  // AC-3 retry hint (#839) — when the order is Allegro-sourced + the
  // buyer's pickup-point hasn't been resolved yet + the order is young
  // enough that it could still arrive on a later poll, surface a
  // non-blocking Alert offering refetch. Doesn't gate submission — the
  // operator can proceed with the kurier fallback if they're confident
  // the pickup-point will never resolve.
  const connectionsQuery = useConnectionsQuery();
  const queryClient = useQueryClient();
  const sourceConnection = (connectionsQuery.data ?? []).find(
    (c) => c.id === order.sourceConnectionId,
  );
  // Trait-driven, not a literal `platformType === 'allegro'` compare (#893):
  // any platform whose pickup-point resolves asynchronously opts in via the
  // `pickupPointResolvesAsync` PlatformContribution slot. `usePlatform` is a
  // hook — keep this call unconditional at the top of the component.
  const sourcePlatform = usePlatform(sourceConnection?.platformType);
  const showPickupRetryHint =
    !hasPickupPoint &&
    !isLikelyCourier &&
    sourcePlatform?.pickupPointResolvesAsync === true &&
    isWithinPickupPointRetryWindow(order.createdAt);
  const [pickupRetryInFlight, setPickupRetryInFlight] = useState(false);
  const handlePickupRetry = async (): Promise<void> => {
    setPickupRetryInFlight(true);
    try {
      // Re-pull the order detail; the order-detail page rerenders this
      // form with the fresh `order` prop and the snapshot re-parses.
      await queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(order.internalOrderId),
      });
    } finally {
      setPickupRetryInFlight(false);
    }
  };

  const form = useForm<GenerateLabelFormValues, undefined, GenerateLabelFormSubmission>({
    defaultValues: {
      // Numeric fields bind to native `<input type="number">`, which RHF sees
      // as strings; `z.coerce.number()` converts at submit. Initial `''` is
      // assignable to `unknown` (the Zod input shape for coerce.number), so
      // no cast is needed.
      length: '',
      width: '',
      height: '',
      weightGrams: '',
      // Allegro flow: paczkomatId is pre-filled buyer-selected; InPost flow:
      // operator types (picker deferred per plan).
      paczkomatId: snapshot.pickupPoint?.id ?? '',
      // COD (#966, decision A) — operator-entered at dispatch; not order-sourced.
      codAmount: '',
      codCurrency: 'PLN',
    },
    resolver: zodResolver(generateLabelSchema),
  });

  // Cache the `register('length')` call so the spread and the explicit-ref
  // callback share the same RHF ref function (don't create two parallel
  // registrations against the same field — tech-review IMPORTANT fix).
  const lengthRegister = form.register('length');
  const widthRegister = form.register('width');
  const heightRegister = form.register('height');
  const weightRegister = form.register('weightGrams');
  const paczkomatRegister = form.register('paczkomatId');
  const codAmountRegister = form.register('codAmount');
  const codCurrencyRegister = form.register('codCurrency');

  // COD orders are flagged by the snapshot's payment status (#928). The COD
  // amount itself isn't persisted (decision A) — the operator enters what to
  // collect here at dispatch.
  const isCodOrder = snapshot.paymentStatus === 'cod';

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
      const result = await mutation.mutateAsync(input);
      if (result.kind === 'dispatched') {
        showToast({
          tone: 'success',
          title: 'Label generated',
          description: 'Tracking number will appear within ~5 minutes.',
        });
        // Auto-download the freshly-issued label (AC: "download triggered
        // immediately after successful generation"). Imperative + guarded on the
        // returned result so it fires exactly once per issuance — NOT a reactive
        // effect, which would re-fire on the post-success query invalidation.
        if (result.shipment?.labelPdfRef) {
          void labelDownload.download(result.shipment.id);
        }
      } else {
        // omp_fulfilled (#953): the destination store fulfils this order — no OL
        // shipment or label is created (also the default path when no
        // fulfillment-routing rule matches). Don't claim a label was generated.
        showToast({
          tone: 'info',
          title: 'Fulfilled by destination store',
          description:
            'This order is fulfilled by the destination store — no OpenLinker label is issued.',
        });
      }
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

  const submitDisabled = mutation.isPending || missingFields.length > 0;

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

      {/* AC-3 retry hint (#839) — Allegro-source order whose pickup-point
          hasn't arrived yet. Non-blocking: operator can still proceed with
          the kurier fallback, or refetch to see if Allegro has caught up. */}
      {showPickupRetryHint ? (
        <Alert tone="info" className="generate-label-form__pickup-retry">
          <strong>Pickup point not yet available</strong>
          <p>
            Allegro hasn&apos;t returned the buyer&apos;s pickup point for this order yet. It
            usually arrives within a few hours of the order — the next poll will populate it.
            You can retry now, or proceed with a courier shipment.
          </p>
          <Button
            type="button"
            tone="secondary"
            className="button--sm"
            onClick={() => {
              void handlePickupRetry();
            }}
            disabled={pickupRetryInFlight}
          >
            {pickupRetryInFlight ? 'Retrying…' : 'Retry pickup-point lookup'}
          </Button>
        </Alert>
      ) : null}

      {/* Pre-flight gate (tech-review BLOCKING fix) — missing snapshot fields
          block submission so the operator can't fire a doomed BE call. */}
      {missingFields.length > 0 ? (
        <Alert tone="warning" className="generate-label-form__missing">
          <strong>Missing recipient data — cannot generate label:</strong>
          <ul className="generate-label-form__missing-list">
            {missingFields.map((field) => (
              <li key={field.id}>{field.message}</li>
            ))}
          </ul>
          <p className="generate-label-form__missing-hint">
            Open this order in the source platform to fix the buyer record, then re-poll.
          </p>
        </Alert>
      ) : null}

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
              {...lengthRegister}
              id={`${dimsBaseId}-length`}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="L"
              aria-label="Length in millimetres"
              ref={(el) => {
                lengthRegister.ref(el);
                firstInputRef.current = el;
              }}
              invalid={Boolean(form.formState.errors.length)}
            />
            <Input
              {...widthRegister}
              id={`${dimsBaseId}-width`}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="W"
              aria-label="Width in millimetres"
              invalid={Boolean(form.formState.errors.width)}
            />
            <Input
              {...heightRegister}
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
            {...weightRegister}
            type="number"
            inputMode="numeric"
            min={1}
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
              {...paczkomatRegister}
              readOnly={paczkomatIsBuyerSelected}
              aria-readonly={paczkomatIsBuyerSelected ? 'true' : undefined}
              placeholder={paczkomatIsBuyerSelected ? undefined : 'POZ08A'}
            />
          </FormField>
        ) : null}

        {/* Cash on delivery (#966, decision A) — optional, operator-entered.
            COD-incapable carriers ignore it; DPD translates it to its COD
            service. Pre-flagged when the order's payment status is COD. */}
        <div className="form-field">
          <p className="form-field__label">Cash on delivery (optional)</p>
          <p className="form-field__description">
            {isCodOrder
              ? 'This order is cash-on-delivery — enter the amount to collect at the door.'
              : 'Amount to collect on delivery. Leave blank for a prepaid shipment.'}
          </p>
          <div className="generate-label-form__cod">
            <Input
              {...codAmountRegister}
              inputMode="decimal"
              placeholder="129.90"
              aria-label="COD amount to collect"
              invalid={Boolean(form.formState.errors.codAmount)}
            />
            <Select {...codCurrencyRegister} aria-label="COD currency">
              {COD_CURRENCY_VALUES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <FieldError id="cod-error" message={form.formState.errors.codAmount?.message} />
        </div>

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
        <Button type="submit" tone="primary" disabled={submitDisabled}>
          {mutation.isPending ? 'Generating label… (~30s)' : 'Generate label'}
        </Button>
      </div>
    </form>
  );
}

interface MissingField {
  id: string;
  message: string;
}

/**
 * Detect snapshot fields the BE `GenerateLabelDto` requires that the order
 * snapshot didn't supply. For paczkomat shipments the address block is
 * optional (parcel goes to the locker, not the buyer's home), so address-side
 * misses don't count.
 *
 * The BE rules this mirrors (`apps/api/src/shipping/http/dto/generate-label.dto.ts`):
 * - `recipient.email` — `@IsEmail()` (always required)
 * - `recipient.phone` — `@IsNotEmpty()` (always required)
 * - `recipient.address.{street,buildingNumber,city,postCode,countryCode}` —
 *   all `@IsNotEmpty()` when the address block is sent. Country code must be
 *   a valid ISO 3166-1 alpha-2 code (the BE just checks `IsString IsNotEmpty`,
 *   but downstream carriers reject anything else).
 */
function detectMissingFields(
  snapshot: ParsedOrderSnapshot,
  shippingMethod: 'paczkomat' | 'kurier',
): MissingField[] {
  const missing: MissingField[] = [];
  if (!snapshot.customerEmail) {
    missing.push({ id: 'email', message: 'Buyer email is missing from the order snapshot.' });
  }
  const phone = snapshot.shippingAddress?.phone;
  if (!phone || phone.trim().length === 0) {
    missing.push({ id: 'phone', message: 'Buyer phone is missing from the shipping address.' });
  }
  // For courier shipments the full address is required by the carrier.
  if (shippingMethod === 'kurier') {
    const a = snapshot.shippingAddress;
    if (!a?.address1) missing.push({ id: 'street', message: 'Shipping street is missing.' });
    if (!a?.city) missing.push({ id: 'city', message: 'Shipping city is missing.' });
    if (!a?.postalCode) missing.push({ id: 'postCode', message: 'Shipping postal code is missing.' });
    if (!a?.country || !isIsoAlpha2(a.country)) {
      missing.push({
        id: 'country',
        message: 'Shipping country must be a 2-letter ISO code (e.g. PL).',
      });
    }
  }
  return missing;
}

function isIsoAlpha2(code: string): boolean {
  return /^[A-Za-z]{2}$/.test(code);
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

  // Paczkomat shipments don't need a delivery address — the parcel goes to
  // the locker. Skip the block entirely (tech-review BLOCKING fix — avoids
  // sending the `'—'` building-number placeholder we used to send).
  //
  // For courier shipments, the pre-flight gate in `detectMissingFields`
  // guarantees a, address1, city, postalCode, and an ISO-alpha-2 country are
  // present by the time we reach here — submit is disabled otherwise. Still
  // guard with `if` so a bug in the gate doesn't crash the form.
  const address =
    shippingMethod === 'kurier' && a && a.address1 && a.city && a.postalCode && a.country
      ? {
          // BE requires both `street` AND `buildingNumber` to be non-empty.
          // OL's address1 typically carries street + number combined; pass
          // the same string to both so the BE validator accepts the call
          // and the carrier system sees the full address in either slot.
          street: a.address1,
          buildingNumber: a.address1,
          city: a.city,
          postCode: a.postalCode,
          countryCode: a.country.toUpperCase(),
        }
      : undefined;

  return {
    sourceConnectionId: order.sourceConnectionId,
    sourceDeliveryMethodId: snapshot.shipping?.methodId ?? null,
    orderId: order.internalOrderId,
    shippingMethod,
    paczkomatId: values.paczkomatId && values.paczkomatId.length > 0 ? values.paczkomatId : undefined,
    recipient: {
      // Address optionals are `string | null | undefined` (#939 — snapshot
      // serialises absent fields as null); coalesce null → undefined for the
      // recipient contract.
      firstName: a?.firstName ?? undefined,
      lastName: a?.lastName ?? undefined,
      // `detectMissingFields` blocks submit when customerEmail is absent, so the
      // `??` only fires defensively (e.g. snapshots predating #948, or hash-only
      // PII mode where the email isn't persisted).
      email: snapshot.customerEmail ?? '',
      phone: a?.phone ?? '',
      address,
    },
    parcel: {
      dimensions: { length: values.length, width: values.width, height: values.height },
      weightGrams: values.weightGrams,
    },
    // COD (#966) — only when the operator entered an amount. Normalise a
    // comma decimal separator to a dot for the wire shape.
    cod:
      values.codAmount && values.codAmount.length > 0
        ? { amount: values.codAmount.replace(',', '.'), currency: values.codCurrency ?? 'PLN' }
        : undefined,
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
