/**
 * Fulfilment-task projection schema (#2411)
 *
 * Parses `GET /fulfillment/works` at the boundary.
 *
 * ## `.nullish()`, never `.optional()` (#939)
 *
 * OpenLinker serialises an absent optional as JSON `null`, so `.optional()` on a
 * nullable field makes the whole surrounding object fail to parse the moment the
 * backend reports "not set" — the section vanishes rather than reading empty.
 * Every nullable field below is `.nullish()` and is normalised to `null`.
 *
 * ## No `z.enum` on the three server-owned vocabularies
 *
 * `status`, `requestStatus` and `supportedActions` are `z.string()`. A
 * `z.enum` here would mean that the day the backend adds a status, the whole
 * task object fails to parse and the panel reports "no fulfilment tasks" for an
 * order that has one — a false statement, and the worst possible direction for
 * a surface whose job is to explain why an order is held. Unrecognised values
 * degrade to their raw string in the copy layer instead.
 *
 * @module apps/web/src/features/fulfillment/api
 */
import { z } from 'zod';

import type { FulfillmentTask, FulfillmentTaskPage } from './fulfillment.types';

/** `null` for a nullish input; the value otherwise. */
const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const fulfillmentTaskLineSchema = z.object({
  id: z.string(),
  orderLineId: z.string(),
  productVariantId: z.string(),
  totalQuantity: z.number(),
  fulfilledQuantity: z.number(),
  cancelledQuantity: z.number(),
});

export const fulfillmentTaskHoldSchema = z.object({
  id: z.string(),
  reason: z.string(),
  note: nullableString,
  placedAt: z.string(),
});

export const fulfillmentTaskSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  locationId: nullableString,
  deliveryMethod: nullableString,
  assignedConnectionId: nullableString,
  status: z.string(),
  requestStatus: z.string(),
  assignmentAttempt: z.number(),
  cancellationReason: nullableString,
  externalWorkId: nullableString,
  acceptedAt: nullableString,
  cancelledAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z
    .array(fulfillmentTaskLineSchema)
    .nullish()
    .transform((value) => value ?? []),
  activeHolds: z
    .array(fulfillmentTaskHoldSchema)
    .nullish()
    .transform((value) => value ?? []),
  supportedActions: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  version: z.number(),
});

export const fulfillmentTaskPageSchema = z.object({
  works: z
    .array(fulfillmentTaskSchema)
    .nullish()
    .transform((value) => value ?? []),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export function parseFulfillmentTask(payload: unknown): FulfillmentTask {
  return fulfillmentTaskSchema.parse(payload);
}

export function parseFulfillmentTaskPage(payload: unknown): FulfillmentTaskPage {
  return fulfillmentTaskPageSchema.parse(payload);
}
