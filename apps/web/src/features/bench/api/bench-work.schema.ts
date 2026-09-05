/**
 * Pack-bench work-list boundary schema (#2416, `W3b-3`)
 *
 * ## `.nullish()`, never `.optional()` (#939)
 *
 * OpenLinker serialises an absent optional as JSON `null`, so `.optional()` on a
 * nullable field makes the WHOLE surrounding object fail to parse the moment the
 * backend reports "not set" — the row vanishes rather than reading empty. On
 * this surface that means a parcel disappearing from a packer's queue because
 * its buyer name was not stored, which is the worst failure the boundary can
 * have. Every nullable field below is `.nullish()` and normalised to `null`.
 *
 * @module apps/web/src/features/bench/api
 */
import { z } from 'zod';

import type { BenchWorkList } from './bench-work.types';

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const benchWorkSchema = z.object({
  workId: z.string(),
  version: z.number(),
  orderId: z.string(),
  orderReference: z.string(),
  buyerName: nullableString,
  dispatchByAt: nullableString,
  parcelIndex: z.number(),
  parcelTotal: z.number(),
  lineCount: z.number(),
  unitsToVerify: z.number(),
  // See the types module: never `z.enum`.
  state: z.string(),
  holdReason: nullableString,
  holdPlacedAt: nullableString,
  expeditedAt: nullableString,
  supportedActions: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
});

export const benchRoutingReadinessSchema = z.object({
  ready: z.boolean(),
  reason: nullableString,
});

export const benchWorkListSchema = z.object({
  works: z
    .array(benchWorkSchema)
    .nullish()
    .transform((value) => value ?? []),
  executorName: nullableString,
  routing: benchRoutingReadinessSchema,
  total: z.number(),
});

export function parseBenchWorkList(payload: unknown): BenchWorkList {
  return benchWorkListSchema.parse(payload);
}
