/**
 * Order Note Types (#3531)
 *
 * Internal, office-facing notes on an order — free text plus one flag
 * (`showToPacker`) that widens ONE note's text onto the pack bench, read only
 * (decision D12). Author edits/deletes their own; an admin may delete any
 * (D33). Attribution is FROZEN at write time (`authorUsername`, the #2282
 * pattern) so a note stays attributed even after its author account is
 * deleted — there is no FK to `users` to cascade or dangle.
 *
 * A note is SOFT-deleted (`deletedAt`), never hard-deleted: "a deleted note
 * leaves an entry without its text" (mockup note 4) requires the row to
 * survive with its body cleared, so the Activity timeline can still place a
 * "Note deleted" event at the right instant.
 *
 * Every EDIT is preceded by a revision row capturing the text as it stood
 * immediately before the edit — `OrderNoteRevision` — because the current row
 * carries only the CURRENT text and "each edit is an Activity timeline entry
 * keeping the previous text" (AC) needs the prior text to still exist
 * somewhere after being overwritten.
 *
 * @module libs/core/src/orders/domain/types
 */

export interface OrderNote {
  id: string;
  internalOrderId: string;
  authorUserId: string;
  /** Frozen at creation — never re-resolved via a join to `users`. */
  authorUsername: string;
  /** The CURRENT text. `''` (empty) once soft-deleted; read `deletedAt` to tell the two apart. */
  body: string;
  showToPacker: boolean;
  /** `null` until the note's first edit. */
  editedAt: Date | null;
  /** `null` unless the note was deleted (soft-delete). */
  deletedAt: Date | null;
  /**
   * `null` = not pinned. At most one non-deleted note per order carries a
   * non-null value (mockup M3: one pinned note, full width under the order
   * header) — the invariant lives on the partial unique index, and `pin`
   * unpins the order's previous pinned note in the same transaction.
   */
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderNoteInput {
  internalOrderId: string;
  authorUserId: string;
  authorUsername: string;
  body: string;
  showToPacker: boolean;
}

export interface UpdateOrderNoteInput {
  body?: string;
  showToPacker?: boolean;
}

/**
 * One past version of a note's text, captured immediately before an edit
 * overwrote it. Append-only — nothing ever updates or deletes a revision row.
 */
export interface OrderNoteRevision {
  id: string;
  noteId: string;
  body: string;
  showToPacker: boolean;
  /** When this revision was superseded — i.e. the instant of the edit that produced it. */
  supersededAt: Date;
}

/**
 * One Activity-timeline-shaped entry, for the FE to fold into
 * `extraEvents`/`DatedTimelineEvent` (`order-activity-timeline.tsx`).
 *
 * `body` carries the text the event is ABOUT: for `created`/`edited` that is
 * the NEW text (the revision the edit produced), never the superseded one —
 * an operator reading the timeline wants to know what the note said from
 * that point on, not what it used to say. `null` for `flag_changed` and
 * `deleted`, which have no text of their own to show.
 */
export const OrderNoteTimelineEventKindValues = [
  'created',
  'edited',
  'flag_changed',
  'deleted',
] as const;
export type OrderNoteTimelineEventKind = (typeof OrderNoteTimelineEventKindValues)[number];

export interface OrderNoteTimelineEntry {
  noteId: string;
  kind: OrderNoteTimelineEventKind;
  occurredAt: Date;
  actorUsername: string;
  body: string | null;
  showToPacker: boolean | null;
}
