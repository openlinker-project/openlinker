/**
 * Sourcing-rule projection schema (#3056)
 *
 * Parses the #2953 admin surface at the boundary, so a shape change surfaces
 * here rather than as an `undefined` three components deep.
 *
 * ## `.nullish()`, never `.optional()` (#939)
 *
 * OpenLinker serialises an absent optional as JSON `null`, so `.optional()` on a
 * nullable field makes the whole surrounding object fail to parse the moment the
 * backend reports "not set" — the table vanishes rather than reading empty.
 *
 * ## No `z.enum` on `kind` / `name` / `afterAction`
 *
 * See the `sourcing-rules.types.ts` docblock: the API deliberately reports
 * unevaluable rules with `recognised: false` instead of hiding them, and a
 * `z.enum` here would hide them again — by failing the parse of the whole list.
 *
 * `priorityLocationIds` is `.nullish()`-tolerant for the same reason even
 * though the DTO always emits an array: a list that renders empty is a
 * survivable degradation, a list that fails to parse is not.
 *
 * @module apps/web/src/features/oms/api
 */
import { z } from 'zod';

import type { SourcingRule } from './sourcing-rules.types';

/** `null` for a nullish input; the value otherwise. */
const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const sourcingRuleSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  position: z.number(),
  kind: z.string(),
  name: z.string(),
  afterAction: z.string(),
  priorityLocationIds: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  effectiveFrom: nullableString,
  effectiveTo: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  recognised: z.boolean(),
});

export const sourcingRuleListSchema = z
  .array(sourcingRuleSchema)
  .nullish()
  .transform((value) => value ?? []);

export function parseSourcingRule(payload: unknown): SourcingRule {
  return sourcingRuleSchema.parse(payload);
}

export function parseSourcingRuleList(payload: unknown): SourcingRule[] {
  return sourcingRuleListSchema.parse(payload);
}
