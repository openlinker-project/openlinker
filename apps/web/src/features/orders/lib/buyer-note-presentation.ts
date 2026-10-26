/**
 * Buyer note presentation rules (#3539)
 *
 * The small pure rule the note surfaces share: how an acting user reads. Kept apart from the components so both
 * can be tested without rendering.
 *
 * @module apps/web/src/features/orders/lib
 */

/**
 * How an acting user reads next to a note. `you` for the signed-in user;
 * `another user` otherwise (B-11): the order payload carries ids, not names, the
 * app has no user-name resolver a viewer is guaranteed to be allowed to call, and
 * a raw OL user id says nothing to the reader. `null` when nobody is recorded.
 */
export function describeNoteActor(
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return currentUserId && userId === currentUserId ? 'you' : 'another user';
}
