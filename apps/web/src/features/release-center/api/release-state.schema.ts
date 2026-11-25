/**
 * Release state boundary schemas (#4146)
 *
 * `.nullish()` normalised to `null`, never `.optional()` (#939): the API
 * serialises an absent optional as JSON null.
 *
 * @module features/release-center/api
 */
import { z } from 'zod';

import type {
  ReleaseCursor,
  ReleaseItemState,
  ReleaseState,
  UpdateReleaseCursorResult,
} from './release-state.types';

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const doneViaSchema = z
  .enum(['auto', 'manual'])
  .nullish()
  .transform((value) => value ?? null);

const cursorSchema = z
  .object({
    lastSeenVersion: nullableString,
    skipDialog: z.boolean(),
    updatedAt: z.string(),
  })
  .nullish()
  .transform((value): ReleaseCursor | null => value ?? null);

const itemStateSchema = z.object({
  itemKey: z.string(),
  scope: z.string(),
  status: z.string(),
  doneVia: doneViaSchema,
  snoozedUntil: nullableString,
  updatedAt: z.string(),
  actedByUserId: nullableString,
});

const releaseStateSchema = z.object({
  enabled: z.boolean(),
  cursor: cursorSchema,
  user: z.array(itemStateSchema),
  installation: z.array(itemStateSchema),
});

const itemsResponseSchema = z.object({ items: z.array(itemStateSchema) });

const cursorResultSchema = z.object({ applied: z.boolean(), cursor: cursorSchema });

export function parseReleaseState(raw: unknown): ReleaseState {
  return releaseStateSchema.parse(raw);
}

export function parseReleaseItems(raw: unknown): ReleaseItemState[] {
  return itemsResponseSchema.parse(raw).items;
}

export function parseCursorResult(raw: unknown): UpdateReleaseCursorResult {
  return cursorResultSchema.parse(raw);
}
