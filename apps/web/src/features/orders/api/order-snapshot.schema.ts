/**
 * Order Snapshot Schema
 *
 * Zod schemas for safely parsing the `orderSnapshot` field of an `OrderRecord`.
 * The snapshot is an opaque `Record<string, unknown>` on the wire; these schemas
 * extract typed view-model data without crashing on partial or legacy payloads.
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
  productId: z.string(),
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

export const orderSnapshotSchema = z.object({
  id: z.string(),
  orderNumber: z.string().optional(),
  status: z.string().optional(),
  items: z.array(orderItemSchema).optional().default([]),
  totals: orderTotalsSchema.optional(),
  shippingAddress: addressSchema.optional(),
  billingAddress: addressSchema.optional(),
});

export type ParsedOrderSnapshot = z.infer<typeof orderSnapshotSchema>;
export type ParsedOrderItem = z.infer<typeof orderItemSchema>;
export type ParsedAddress = z.infer<typeof addressSchema>;
export type ParsedOrderTotals = z.infer<typeof orderTotalsSchema>;

export function parseOrderSnapshot(
  snapshot: Record<string, unknown>,
): ParsedOrderSnapshot | null {
  const result = orderSnapshotSchema.safeParse(snapshot);
  return result.success ? result.data : null;
}
