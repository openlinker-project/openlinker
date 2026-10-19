/**
 * Routing dry-run response schema (#2954)
 *
 * Parses the response at the boundary. `.nullish()` rather than `.optional()`
 * where the backend may serialise an absent value as `null` (#939). No `z.enum`
 * on reasons or rule names: they are the router's opaque words.
 *
 * @module apps/web/src/features/oms/api
 */
import { z } from 'zod';

import type { RoutingDryRunResult } from './routing-dry-run.types';

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const evaluationSchema = z.object({
  candidates: z.array(
    z.object({
      orderLineId: z.string(),
      locationId: nullableString,
      connectionId: nullableString,
      deliveryMethod: nullableString,
      quantity: z.number(),
    })
  ),
  unfulfillable: z.array(
    z.object({
      orderLineId: z.string(),
      quantity: z.number(),
      resolution: z.enum(['refund', 'return']),
      reason: z.string(),
    })
  ),
  explanation: z.array(
    z.object({
      rule: z.object({ ruleId: z.string(), name: z.string(), displayLabel: z.string() }),
      eliminated: z.array(z.string()),
      score: z.number().nullish().transform((value) => value ?? null),
      detail: nullableString,
    })
  ),
});

const dryRunResultSchema = z.object({
  input: z.object({
    lines: z.array(
      z.object({ orderLineId: z.string(), productVariantId: z.string(), quantity: z.number() })
    ),
    shipTo: z.object({
      mode: z.string(),
      countryIso2: z.string(),
      postalCode: z.string().nullish(),
      city: z.string().nullish(),
      locationHash: z.string().nullish(),
    }),
    requestedDeliveryMethod: nullableString,
  }),
  saved: evaluationSchema,
  draft: evaluationSchema.nullish().transform((value) => value ?? undefined),
  changedLines: z
    .array(z.object({ orderLineId: z.string(), saved: z.array(z.string()), draft: z.array(z.string()) }))
    .nullish()
    .transform((value) => value ?? undefined),
});

export function parseRoutingDryRunResult(payload: unknown): RoutingDryRunResult {
  return dryRunResultSchema.parse(payload) as RoutingDryRunResult;
}
