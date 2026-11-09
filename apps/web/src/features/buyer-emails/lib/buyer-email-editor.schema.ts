/**
 * Buyer Email Template Editor Form Schema (#3555)
 *
 * The editor's draft: the per-connection switch and sender, and the shared
 * subject and message. Mirrors what `PATCH /connections/:id` and
 * `PUT /automations/:id` refuse, so a value the API would reject is caught
 * before the request; the server stays the source of truth, and a refusal it
 * still returns is shown as the save's own error.
 *
 * The wording is only validated when it is editable: a template whose seeded
 * rule is missing renders its subject and message disabled, and a disabled
 * input submits no value.
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import { z } from 'zod';
import { isSingleEmailAddress } from './buyer-emails-config';
import { getMessages } from '../../../shared/i18n';

/** Empty means "use the mail settings' sender"; anything else must be one bare address. */
function optionalAddress(invalidAddress: string): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || isSingleEmailAddress(value), invalidAddress);
}

export interface BuyerEmailEditorFormValues {
  /** Absent when the switch is disabled (no rule): a disabled input submits nothing. */
  enabled?: boolean;
  fromAddress: string;
  replyTo: string;
  subject?: string;
  body?: string;
}

export function buildBuyerEmailEditorSchema(options: {
  wordingEditable: boolean;
}): z.ZodType<BuyerEmailEditorFormValues, BuyerEmailEditorFormValues> {
  const COPY = getMessages('buyer-emails').editor;
  const wording = options.wordingEditable
    ? {
        subject: z.string().trim().min(1, COPY.subjectRequired).max(998),
        body: z.string().trim().min(1, COPY.bodyRequired).max(20000),
      }
    : { subject: z.string().optional(), body: z.string().optional() };
  return z.object({
    enabled: z.boolean().optional(),
    fromAddress: optionalAddress(COPY.invalidAddress),
    replyTo: optionalAddress(COPY.invalidAddress),
    ...wording,
  });
}

/** The test-send address: required, one bare address. Built when called, in the active language. */
export interface BuyerEmailTestFormValues {
  to: string;
}

export function buildBuyerEmailTestFormSchema(): z.ZodType<BuyerEmailTestFormValues, BuyerEmailTestFormValues> {
  const COPY = getMessages('buyer-emails').editor;
  return z.object({
    to: z
      .string()
      .trim()
      .min(1, COPY.invalidAddress)
      .refine((value) => isSingleEmailAddress(value), COPY.invalidAddress),
  });
}

