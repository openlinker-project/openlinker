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

const orderTotalsSchema = z.object({
  subtotal: z.number(),
  tax: z.number(),
  shipping: z.number(),
  total: z.number(),
  currency: z.string(),
});

export type ParsedOrderItem = z.infer<typeof orderItemSchema>;
export type ParsedAddress = z.infer<typeof addressSchema>;
export type ParsedOrderTotals = z.infer<typeof orderTotalsSchema>;

export interface ParseWarning {
  field: string;
  message: string;
}

export interface ParsedOrderSnapshot {
  id?: string;
  orderNumber?: string;
  status?: string;
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
  shippingAddress?: ParsedAddress;
  billingAddress?: ParsedAddress;
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

  return {
    id,
    orderNumber,
    status,
    items,
    totals,
    shippingAddress,
    billingAddress,
    parseWarnings: warnings,
  };
}
