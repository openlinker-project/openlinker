/**
 * Buyer note presentation rules (#3539)
 *
 * Two small pure rules the note surfaces share: when a note is long enough to
 * clamp, and how an acting user reads. Kept apart from the components so both
 * can be tested without rendering.
 *
 * @module apps/web/src/features/orders/lib
 */

/**
 * The note is clamped to four lines by CSS (a line count, not a character
 * count), but whether to OFFER the "Show the whole note" control cannot be read
 * back from the DOM in a way that is stable across fonts and widths. This is
 * the conservative estimate: more than four hard line breaks, or long enough
 * that it will not fit four lines of the 75ch measure. A short note therefore
 * never grows a control that does nothing.
 */
const CLAMP_CHARACTERS = 280;
const CLAMP_LINES = 4;

export function isLongBuyerNote(text: string): boolean {
  return text.length > CLAMP_CHARACTERS || text.split('\n').length > CLAMP_LINES;
}

/**
 * How an acting user reads next to a note. `you` for the signed-in user; the
 * raw OL user id otherwise, which is what the packed mark already shows - the
 * order payload carries ids, not names, and resolving them would need a users
 * read the viewer may not be allowed. `null` when nobody is recorded.
 */
export function describeNoteActor(
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return currentUserId && userId === currentUserId ? 'you' : userId;
}
