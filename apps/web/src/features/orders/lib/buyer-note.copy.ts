/**
 * Buyer note copy (#3539, mockup M2)
 *
 * Every operator-facing string for the buyer note on the order surfaces, in one
 * place so the detail block, the list row, the filter chip and the Activity
 * entry cannot drift. The pack bench has its own copy beside its own surface
 * (`features/bench/lib/bench-parcel.copy.ts`): a packer reads a different
 * sentence from an office user, for the same fact.
 *
 * @module apps/web/src/features/orders/lib
 */
export const BUYER_NOTE_COPY = {
  title: 'Buyer note',
  /** Names who wrote it (the buyer), where (the channel) and when (at checkout). */
  meta: (channel: string | null): string =>
    channel === null
      ? 'Written by the buyer at checkout'
      : `Written by the buyer at checkout on ${channel}`,
  copy: 'Copy',
  copied: 'Copied',
  copyAria: 'Copy the buyer note',
  showAll: (characters: number): string => `Show the whole note (${String(characters)} characters)`,
  showLess: 'Show less',
  markRead: 'Mark as read',
  markingRead: 'Saving...',
  markReadFailed: 'That did not save. The note is still unread - press it again.',
  unread: 'Not read yet',
  read: 'Read',
  /** Read in the office, by an operator. */
  readBy: (who: string | null): string => (who === null ? 'Read' : `Read by ${who}`),
  /** Bench acknowledgement is a separate, per-parcel fact. */
  notReadAtBench: 'Not marked as read at the bench yet.',
  readAtBench: 'Read at the bench',
  aPacker: 'a packer',
  /** A note exists but the deployment keeps no note text. */
  textNotStored: 'The buyer left a note, but this installation does not store its text.',
  // Orders list
  listIndicator: 'Buyer note',
  listIndicatorTitle: 'The buyer left a note for the seller - open the order to read it.',
  listUnknownHint: 'The channel did not say whether the buyer left a note.',
  rowFieldLabel: 'Buyer note',
  rowLoading: 'Loading the note...',
  rowUnreadable: 'The note could not be loaded. Open the order to read it.',
  // Activity timeline
  timelineTitle: 'Buyer note read at the bench',
  timelineBy: 'bench',
  timelineDescription: (who: string | null): string =>
    who === null ? 'Read by a packer.' : `Read by ${who}.`,
} as const;
