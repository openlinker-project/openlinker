/**
 * Buyer note presentation rules (#3539)
 *
 * The small pure rule the note surfaces share: how an acting user reads. Kept apart from the components so both
 * can be tested without rendering.
 *
 * @module apps/web/src/features/orders/lib
 */

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
