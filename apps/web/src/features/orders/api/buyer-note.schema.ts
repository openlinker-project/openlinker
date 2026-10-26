/**
 * Buyer note schema (#3539)
 *
 * Zod for the buyer-note fields on an order record, and the one reader that
 * turns them into a view state. The wire carries the note in THREE states
 * (see `OrderRecord.buyerNote`), and a `.nullish()` schema would erase exactly
 * the difference the API went out of its way to keep, so the schema is
 * `.nullable().optional()` and the reader tests `=== undefined` first.
 *
 * Every consumer renders from `readBuyerNote`, never from a truthiness test on
 * the field: `''` and whitespace are "no note", an absent key is "unknown", and
 * a note that exists but whose text was not stored is its own state.
 *
 * @module apps/web/src/features/orders/api
 */
import { z } from 'zod/v4';

import type { BuyerNoteAcknowledgement, OrderRecord } from './orders.types';

const acknowledgementSchema = z.object({
  workId: z.string(),
  acknowledgedAt: z.string(),
  acknowledgedByUserId: z.string().nullish(),
});

export const buyerNoteFieldsSchema = z.object({
  hasBuyerNote: z.boolean().optional(),
  buyerNote: z.string().nullable().optional(),
  buyerNoteReadAt: z.string().nullable().optional(),
  buyerNoteReadByUserId: z.string().nullable().optional(),
  buyerNoteAcknowledgements: z.array(acknowledgementSchema).optional(),
});

/** What the detail page can say about the note. */
export type BuyerNoteView =
  /** The note, verbatim. `readAt` / `readByUserId` are `null` while unread. */
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly readAt: string | null;
      readonly readByUserId: string | null;
      readonly acknowledgements: readonly BuyerNoteAcknowledgement[];
    }
  /** A note exists but this deployment does not store its text. */
  | { readonly kind: 'text-not-stored' }
  /** The source asserted the buyer wrote nothing. Renders nothing. */
  | { readonly kind: 'none' }
  /** The source could not say. Renders nothing on the detail page. */
  | { readonly kind: 'unknown' };

type BuyerNoteSource = Pick<
  OrderRecord,
  | 'hasBuyerNote'
  | 'buyerNote'
  | 'buyerNoteReadAt'
  | 'buyerNoteReadByUserId'
  | 'buyerNoteAcknowledgements'
>;

export function readBuyerNote(order: BuyerNoteSource): BuyerNoteView {
  const parsed = buyerNoteFieldsSchema.safeParse(order);
  // A payload this build cannot read is "unknown", never "no note".
  if (!parsed.success) return { kind: 'unknown' };
  const fields = parsed.data;

  if (typeof fields.buyerNote === 'string') {
    const text = fields.buyerNote;
    if (text.trim().length === 0) return { kind: 'none' };
    return {
      kind: 'text',
      text,
      readAt: fields.buyerNoteReadAt ?? null,
      readByUserId: fields.buyerNoteReadByUserId ?? null,
      acknowledgements: (fields.buyerNoteAcknowledgements ?? []).map((entry) => ({
        workId: entry.workId,
        acknowledgedAt: entry.acknowledgedAt,
        acknowledgedByUserId: entry.acknowledgedByUserId ?? null,
      })),
    };
  }
  if (fields.buyerNote === null) return { kind: 'none' };
  return fields.hasBuyerNote === true ? { kind: 'text-not-stored' } : { kind: 'unknown' };
}
