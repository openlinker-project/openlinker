/**
 * Automatic shipping labels - response parsing (#2729)
 *
 * Both reads run through Zod rather than a cast, so a contract break surfaces
 * as an unreadable response the screen can report, instead of `undefined`
 * rendered into a cell. An unrecognised reason code does NOT fail the parse: it
 * becomes `unknown`, so a refusal a newer backend invented is still listed.
 *
 * @module apps/web/src/features/auto-dispatch/api
 */
import { z } from 'zod';

import {
  AutoDispatchPreviewRefusalValues,
  AutoDispatchRefusalBucketValues,
  AutoDispatchRefusalCodeValues,
  type AutoDispatchPreview,
  type AutoDispatchRefusalCode,
  type AutoDispatchRefusals,
} from './auto-dispatch.types';

const holderSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
  platformType: z.string(),
  holdsWork: z.boolean(),
  autoDispatchEnabled: z.boolean(),
});

const codeSchema = z
  .string()
  .transform((value): AutoDispatchRefusalCode =>
    (AutoDispatchRefusalCodeValues as readonly string[]).includes(value)
      ? (value as AutoDispatchRefusalCode)
      : 'unknown'
  );

const refusalSchema = z.object({
  jobId: z.string(),
  workId: z.string().nullable(),
  orderId: z.string().nullable(),
  code: codeSchema,
  bucket: z.enum(AutoDispatchRefusalBucketValues),
  since: z.string(),
  attempts: z.number(),
  maxAttempts: z.number(),
});

const refusalsSchema = z.object({
  holder: holderSchema,
  needsInput: z.array(refusalSchema),
  retrying: z.array(refusalSchema),
});

const previewItemSchema = z.object({
  workId: z.string(),
  orderId: z.string(),
  weightGrams: z.number().nullable(),
  template: z.string().nullable(),
  dimensions: z
    .object({ length: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  refusal: z.enum(AutoDispatchPreviewRefusalValues).nullable(),
});

const previewSchema = z.object({
  holder: holderSchema,
  items: z.array(previewItemSchema),
});

/** `null` when the response cannot be read; the caller reports it, never renders it as "no refusals". */
export function parseAutoDispatchRefusals(raw: unknown): AutoDispatchRefusals | null {
  const result = refusalsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** `null` when the response cannot be read; the caller reports it, never renders it as "nothing to preview". */
export function parseAutoDispatchPreview(raw: unknown): AutoDispatchPreview | null {
  const result = previewSchema.safeParse(raw);
  return result.success ? result.data : null;
}
