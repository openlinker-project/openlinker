/**
 * Order Snapshot Schema
 *
 * Zod schemas for extracting typed view-model data from an OrderRecord's
 * opaque `orderSnapshot` field. Parses each sub-tree (items, totals,
 * shipping/billing address) independently so that a single malformed
 * section never blanks the whole detail page. Non-fatal parse failures
 * are surfaced via `parseWarnings` so the page can show a "why is this
 * empty?" breadcrumb rather than failing silently.
 *
 * @module apps/web/src/features/orders/api
 */
import { z } from 'zod/v4';

const addressSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  address1: z.string(),
  address2: z.string().optional(),
  city: z.string(),
  state: z.string().optional(),
  postalCode: z.string(),
  country: z.string(),
  phone: z.string().optional(),
});

const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  quantity: z.number(),
  price: z.number(),
  sku: z.string().optional(),
  name: z.string().optional(),
  imageUrl: z.string().optional(),
});

/**
 * Tax-treatment values — hand-mirrored from `PriceTaxTreatmentValues` in
 * `libs/core/src/orders/domain/types/order.types.ts` per the FE-001 contract
 * strategy. The backend already pins `totals.taxTreatment` into the persisted
 * snapshot (#895/ADR-014); surfacing it here is a read-only extension, not a
 * new field. Keep in sync with the core constant if the vocabulary changes.
 */
export const ParsedOrderTaxTreatmentValues = ['inclusive', 'exclusive'] as const;
export type ParsedOrderTaxTreatment = (typeof ParsedOrderTaxTreatmentValues)[number];

const orderTotalsSchema = z.object({
  subtotal: z.number(),
  tax: z.number(),
  shipping: z.number(),
  total: z.number(),
  currency: z.string(),
  /** Whether `total` is tax-inclusive (gross) or tax-exclusive (net). Optional —
   *  absent for sources that don't report it. */
  taxTreatment: z.enum(ParsedOrderTaxTreatmentValues).optional(),
});

const orderShippingSchema = z.object({
  /** Source-side delivery-method id (routing-rule lookup key). */
  methodId: z.string(),
  /** Operator-facing label (e.g. "InPost Paczkomaty"). */
  methodName: z.string().optional(),
});

const orderPickupPointSchema = z.object({
  /** Bare locker code (e.g. `POZ08A`). */
  id: z.string(),
  /** Operator-facing label (e.g. `Paczkomat POZ08A`). */
  name: z.string().optional(),
  /** Locker-side description (e.g. `Stacja paliw BP`). */
  description: z.string().optional(),
});

export type ParsedOrderItem = z.infer<typeof orderItemSchema>;
export type ParsedAddress = z.infer<typeof addressSchema>;
export type ParsedOrderTotals = z.infer<typeof orderTotalsSchema>;
export type ParsedOrderShipping = z.infer<typeof orderShippingSchema>;
export type ParsedOrderPickupPoint = z.infer<typeof orderPickupPointSchema>;

export interface ParseWarning {
  field: string;
  message: string;
}

export interface ParsedOrderSnapshot {
  id?: string;
  orderNumber?: string;
  status?: string;
  /**
   * Buyer email from the source platform — adapters typically populate from
   * `IncomingOrder.customerEmail`. Consumed by the Generate Label form
   * (#769) to pre-fill the recipient.email field; absent for sources that
   * don't expose it (in which case the operator types it).
   */
  customerEmail?: string;
  /**
   * When the buyer placed the order on the source marketplace (#926) — ISO
   * string. The operationally meaningful order date; the detail/list surfaces
   * lead with it and fall back to the record's ingestion `createdAt` when
   * absent (older records, sources that don't expose a placed time).
   */
  placedAt?: string;
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
  shippingAddress?: ParsedAddress;
  billingAddress?: ParsedAddress;
  /**
   * Source-side shipping reference (#769). When present, `methodId` is the
   * routing-rule lookup key the dispatch seam consumes. Absent for sources
   * that don't expose a delivery-method id.
   */
  shipping?: ParsedOrderShipping;
  /**
   * Pickup-point reference (#769). Present only for pickup-point orders
   * (Allegro brokered paczkomats, InPost-direct locker orders). The
   * Generate Label form pre-fills this as the `paczkomatId` for the
   * Allegro Delivery flow — buyer-selected per AC-3.
   */
  pickupPoint?: ParsedOrderPickupPoint;
  parseWarnings: ParseWarning[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'invalid value';
}

/**
 * Soft-parse an order snapshot: each sub-tree is validated independently
 * via `safeParse`, failures are pushed to `parseWarnings`, and the caller
 * gets back whatever could be parsed. Never throws, never returns null.
 */
export function parseOrderSnapshot(snapshot: Record<string, unknown>): ParsedOrderSnapshot {
  const warnings: ParseWarning[] = [];

  // Top-level scalar fields — tolerate missing / wrong-typed silently.
  const id = typeof snapshot.id === 'string' ? snapshot.id : undefined;
  const orderNumber =
    typeof snapshot.orderNumber === 'string' ? snapshot.orderNumber : undefined;
  const status = typeof snapshot.status === 'string' ? snapshot.status : undefined;
  const customerEmail =
    typeof snapshot.customerEmail === 'string' && snapshot.customerEmail.length > 0
      ? snapshot.customerEmail
      : undefined;
  const placedAt =
    typeof snapshot.placedAt === 'string' && snapshot.placedAt.length > 0
      ? snapshot.placedAt
      : undefined;

  // Items — parse each element independently so one bad row doesn't drop the rest.
  const items: ParsedOrderItem[] = [];
  if (Array.isArray(snapshot.items)) {
    snapshot.items.forEach((raw, index) => {
      const result = orderItemSchema.safeParse(raw);
      if (result.success) {
        items.push(result.data);
      } else {
        warnings.push({
          field: `items[${index}]`,
          message: firstZodMessage(result.error),
        });
      }
    });
  } else if (snapshot.items !== undefined) {
    warnings.push({ field: 'items', message: 'expected an array' });
  }

  // Totals — optional; only warn when present-but-wrong.
  let totals: ParsedOrderTotals | undefined;
  if (snapshot.totals !== undefined) {
    const result = orderTotalsSchema.safeParse(snapshot.totals);
    if (result.success) {
      totals = result.data;
    } else {
      warnings.push({ field: 'totals', message: firstZodMessage(result.error) });
    }
  }

  // Shipping + billing addresses — same pattern as totals.
  let shippingAddress: ParsedAddress | undefined;
  if (snapshot.shippingAddress !== undefined) {
    const candidate = asRecord(snapshot.shippingAddress);
    if (candidate === null) {
      warnings.push({ field: 'shippingAddress', message: 'expected an object' });
    } else {
      const result = addressSchema.safeParse(candidate);
      if (result.success) {
        shippingAddress = result.data;
      } else {
        warnings.push({ field: 'shippingAddress', message: firstZodMessage(result.error) });
      }
    }
  }

  let billingAddress: ParsedAddress | undefined;
  if (snapshot.billingAddress !== undefined) {
    const candidate = asRecord(snapshot.billingAddress);
    if (candidate === null) {
      warnings.push({ field: 'billingAddress', message: 'expected an object' });
    } else {
      const result = addressSchema.safeParse(candidate);
      if (result.success) {
        billingAddress = result.data;
      } else {
        warnings.push({ field: 'billingAddress', message: firstZodMessage(result.error) });
      }
    }
  }

  // Shipping reference (routing-rule key) — optional.
  let shipping: ParsedOrderShipping | undefined;
  if (snapshot.shipping !== undefined) {
    const candidate = asRecord(snapshot.shipping);
    if (candidate === null) {
      warnings.push({ field: 'shipping', message: 'expected an object' });
    } else {
      const result = orderShippingSchema.safeParse(candidate);
      if (result.success) {
        shipping = result.data;
      } else {
        warnings.push({ field: 'shipping', message: firstZodMessage(result.error) });
      }
    }
  }

  // Pickup-point — optional (paczkomat orders only).
  let pickupPoint: ParsedOrderPickupPoint | undefined;
  if (snapshot.pickupPoint !== undefined) {
    const candidate = asRecord(snapshot.pickupPoint);
    if (candidate === null) {
      warnings.push({ field: 'pickupPoint', message: 'expected an object' });
    } else {
      const result = orderPickupPointSchema.safeParse(candidate);
      if (result.success) {
        pickupPoint = result.data;
      } else {
        warnings.push({ field: 'pickupPoint', message: firstZodMessage(result.error) });
      }
    }
  }

  return {
    id,
    orderNumber,
    status,
    customerEmail,
    placedAt,
    items,
    totals,
    shippingAddress,
    billingAddress,
    shipping,
    pickupPoint,
    parseWarnings: warnings,
  };
}
