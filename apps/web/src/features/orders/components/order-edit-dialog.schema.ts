/**
 * Order edit form schema and request builders (#3544)
 *
 * The edit form is ONE form over four endpoints: address, delivery method, line
 * quantities and discount are each submitted separately, and only the sections
 * the operator actually changed are sent. Every field is a string in the form
 * (a number input yields one anyway), parsed on the way out, so a half-typed
 * quantity never becomes `NaN` in the wire body.
 *
 * The validation is the SERVER's rules mirrored as a convenience, so the
 * operator learns while typing rather than from a refused request: a quantity
 * only goes down, not every line may reach zero, a discount is a plain decimal
 * or a percent in 0 to 100. The server stays authoritative and every refusal it
 * answers is rendered (`lib/order-edit.ts`).
 *
 * Nothing here computes a total: the figures come back from the dry run.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import type { ParsedOrderSnapshot } from '../api/order-snapshot.schema';
import type {
  EditOrderAddressRequest,
  EditOrderDeliveryMethodRequest,
  EditOrderDiscountRequest,
  EditOrderLinesRequest,
  OrderEditRequest,
  OrderEditsView,
} from '../api/order-edit.types';
import {
  isPlainDecimal,
  keepsAnyUnit,
  ORDER_EDIT_DISCOUNT_MODES,
  type OrderEditSection,
} from '../lib/order-edit';

export interface OrderEditLineValue {
  orderLineId: string;
  quantity: string;
}

export interface OrderEditFormValues {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  methodId: string;
  methodName: string;
  pickupId: string;
  pickupName: string;
  lines: OrderEditLineValue[];
  discountMode: (typeof ORDER_EDIT_DISCOUNT_MODES)[number];
  discountValue: string;
  acknowledgeAcceptedWork: boolean;
  acknowledgeAboveCeiling: boolean;
}

/** What the form was opened with, so a section's "changed" is a comparison and not a flag. */
export type OrderEditInitialValues = OrderEditFormValues;

/** Display data for the quantity table; not part of the submitted values. */
export interface OrderEditLineMeta {
  orderLineId: string;
  name: string | null;
  sku: string | null;
  /** The quantity the order has now: the ceiling the input may not pass. */
  maxQuantity: number;
  /** The channel's own quantity when it differs, for the "of N" caption. */
  channelQuantity: number;
}

export function buildOrderEditInitialValues(
  snapshot: ParsedOrderSnapshot,
  edits: OrderEditsView | null | undefined,
): OrderEditInitialValues {
  const address = snapshot.shippingAddress;
  return {
    firstName: address?.firstName ?? '',
    lastName: address?.lastName ?? '',
    company: address?.company ?? '',
    address1: address?.address1 ?? '',
    address2: address?.address2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? '',
    phone: address?.phone ?? '',
    methodId: snapshot.shipping?.methodId ?? '',
    methodName: snapshot.shipping?.methodName ?? '',
    pickupId: snapshot.pickupPoint?.id ?? '',
    pickupName: snapshot.pickupPoint?.name ?? '',
    lines: snapshot.items.map((item) => ({
      orderLineId: item.id,
      quantity: String(item.quantity),
    })),
    discountMode: 'amount',
    discountValue: edits?.discount?.amount ?? '',
    acknowledgeAcceptedWork: false,
    acknowledgeAboveCeiling: false,
  };
}

export function buildOrderEditLineMeta(
  snapshot: ParsedOrderSnapshot,
  edits: OrderEditsView | null | undefined,
): OrderEditLineMeta[] {
  const channelById = new Map(
    (edits?.lines ?? []).map((line) => [line.orderLineId, line.channelQuantity] as const),
  );
  return snapshot.items.map((item) => ({
    orderLineId: item.id,
    name: item.name ?? null,
    sku: item.sku ?? null,
    maxQuantity: item.quantity,
    channelQuantity: channelById.get(item.id) ?? item.quantity,
  }));
}

const trim = (value: string): string => value.trim();

function sameText(a: string, b: string): boolean {
  return trim(a) === trim(b);
}

function sameDiscountAmount(a: string, b: string): boolean {
  if (!isPlainDecimal(a) || !isPlainDecimal(b)) return trim(a) === trim(b);
  return Number(a) === Number(b);
}

/** Which sections differ from what the form opened with. A blank discount is "untouched". */
export function detectChangedSections(
  values: OrderEditFormValues,
  initial: OrderEditInitialValues,
): ReadonlySet<OrderEditSection> {
  const changed = new Set<OrderEditSection>();
  const addressKeys = [
    'firstName',
    'lastName',
    'company',
    'address1',
    'address2',
    'city',
    'state',
    'postalCode',
    'country',
    'phone',
  ] as const;
  if (addressKeys.some((key) => !sameText(values[key], initial[key]))) changed.add('address');
  const deliveryKeys = ['methodId', 'methodName', 'pickupId', 'pickupName'] as const;
  if (deliveryKeys.some((key) => !sameText(values[key], initial[key]))) changed.add('delivery');
  const initialById = new Map(initial.lines.map((line) => [line.orderLineId, line.quantity]));
  if (values.lines.some((line) => !sameText(line.quantity, initialById.get(line.orderLineId) ?? ''))) {
    changed.add('lines');
  }
  const discount = trim(values.discountValue);
  if (discount !== '') {
    const sameAsBefore =
      values.discountMode === 'amount' && sameDiscountAmount(discount, initial.discountValue);
    if (!sameAsBefore) changed.add('discount');
  }
  return changed;
}

/**
 * The form schema for one order. `initial` and `lineMax` make it a factory: a
 * section is only validated when the operator changed it, so a record with no
 * stored address (a deployment that stores no buyer PII) does not block an
 * unrelated quantity edit.
 */
export function buildOrderEditSchema(
  initial: OrderEditInitialValues,
  lineMax: Readonly<Record<string, number>>,
) {
  return z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      company: z.string(),
      address1: z.string(),
      address2: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string(),
      phone: z.string(),
      methodId: z.string(),
      methodName: z.string(),
      pickupId: z.string(),
      pickupName: z.string(),
      lines: z.array(z.object({ orderLineId: z.string(), quantity: z.string() })),
      discountMode: z.enum(ORDER_EDIT_DISCOUNT_MODES),
      discountValue: z.string(),
      acknowledgeAcceptedWork: z.boolean(),
      acknowledgeAboveCeiling: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const changed = detectChangedSections(values, initial);

      if (changed.has('address')) {
        for (const [key, label] of [
          ['address1', 'Enter the street and number'],
          ['city', 'Enter the city'],
          ['postalCode', 'Enter the postcode'],
        ] as const) {
          if (trim(values[key]) === '') ctx.addIssue({ code: 'custom', path: [key], message: label });
        }
        if (!/^[A-Za-z]{2}$/.test(trim(values.country))) {
          ctx.addIssue({
            code: 'custom',
            path: ['country'],
            message: 'Use a two-letter country code, e.g. PL',
          });
        }
      }

      if (changed.has('delivery') && trim(values.methodId) === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['methodId'],
          message: 'Enter the delivery method id',
        });
      }
      if (trim(values.pickupName) !== '' && trim(values.pickupId) === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['pickupId'],
          message: 'A pickup point needs its code',
        });
      }

      if (changed.has('lines')) {
        const quantities: number[] = [];
        values.lines.forEach((line, index) => {
          const raw = trim(line.quantity);
          const quantity = Number(raw);
          const max = lineMax[line.orderLineId] ?? 0;
          quantities.push(Number.isInteger(quantity) ? quantity : 0);
          if (raw === '' || !Number.isInteger(quantity) || quantity < 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['lines', index, 'quantity'],
              message: 'Enter a whole number, 0 or more',
            });
          } else if (quantity > max) {
            ctx.addIssue({
              code: 'custom',
              path: ['lines', index, 'quantity'],
              message: `Can only go down: at most ${max}`,
            });
          }
        });
        if (!keepsAnyUnit(quantities)) {
          ctx.addIssue({
            code: 'custom',
            path: ['lines'],
            message: 'An order needs at least one item. To remove everything, cancel the order.',
          });
        }
      }

      if (changed.has('discount')) {
        const raw = trim(values.discountValue);
        if (values.discountMode === 'amount') {
          if (!isPlainDecimal(raw)) {
            ctx.addIssue({
              code: 'custom',
              path: ['discountValue'],
              message: 'Enter a plain amount such as 12.50, or 0 to remove the discount',
            });
          }
        } else {
          const percent = Number(raw);
          if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
            ctx.addIssue({
              code: 'custom',
              path: ['discountValue'],
              message: 'Enter a percent from 0 to 100',
            });
          }
        }
      }
    });
}

export type OrderEditSubmission = z.output<ReturnType<typeof buildOrderEditSchema>>;

/** One request per changed section, in the order they are sent: lines before the discount. */
export interface PlannedOrderEdit {
  section: OrderEditSection;
  edit: OrderEditRequest;
}

const optional = (value: string): string | undefined => (trim(value) === '' ? undefined : trim(value));

export function planOrderEdits(
  values: OrderEditFormValues,
  initial: OrderEditInitialValues,
  options: { dryRun: boolean },
): PlannedOrderEdit[] {
  const changed = detectChangedSections(values, initial);
  const dryRun = options.dryRun ? { dryRun: true } : {};
  const plan: PlannedOrderEdit[] = [];

  if (changed.has('address')) {
    const body: EditOrderAddressRequest = {
      ...dryRun,
      firstName: optional(values.firstName),
      lastName: optional(values.lastName),
      company: optional(values.company),
      address1: trim(values.address1),
      address2: optional(values.address2),
      city: trim(values.city),
      state: optional(values.state),
      postalCode: trim(values.postalCode),
      country: trim(values.country).toUpperCase(),
      phone: optional(values.phone),
    };
    plan.push({ section: 'address', edit: { kind: 'address', body } });
  }

  if (changed.has('delivery')) {
    const pickupId = optional(values.pickupId);
    const body: EditOrderDeliveryMethodRequest = {
      ...dryRun,
      methodId: trim(values.methodId),
      methodName: optional(values.methodName),
      ...(pickupId !== undefined
        ? { pickupPoint: { id: pickupId, name: optional(values.pickupName) } }
        : {}),
    };
    plan.push({ section: 'delivery', edit: { kind: 'delivery-method', body } });
  }

  if (changed.has('lines')) {
    const initialById = new Map(initial.lines.map((line) => [line.orderLineId, line.quantity]));
    const body: EditOrderLinesRequest = {
      ...dryRun,
      // Only the lines that went down: the server refuses a line it is told is unchanged.
      lines: values.lines
        .filter((line) => !sameText(line.quantity, initialById.get(line.orderLineId) ?? ''))
        .map((line) => ({ orderLineId: line.orderLineId, quantity: Number(trim(line.quantity)) })),
      // Sent only when ticked: an untouched box must not claim an acknowledgement never given.
      ...(values.acknowledgeAcceptedWork ? { acknowledgeAcceptedWork: true } : {}),
    };
    plan.push({ section: 'lines', edit: { kind: 'lines', body } });
  }

  if (changed.has('discount')) {
    const raw = trim(values.discountValue);
    const body: EditOrderDiscountRequest = {
      ...dryRun,
      ...(values.discountMode === 'percent' ? { percent: Number(raw) } : { amount: raw }),
      ...(values.acknowledgeAboveCeiling ? { acknowledgeAboveCeiling: true } : {}),
    };
    plan.push({ section: 'discount', edit: { kind: 'discount', body } });
  }

  return plan;
}
