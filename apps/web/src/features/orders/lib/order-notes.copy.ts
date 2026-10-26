/**
 * Order notes — operator-facing copy (#3531/#3533, mockup M3)
 *
 * Every sentence the notes section, the pinned-note banner and the notes'
 * Activity-timeline entries say, in one reviewable place.
 *
 * @module apps/web/src/features/orders/lib
 */

/** Server-enforced too (`CreateOrderNoteDto`); the counter only mirrors it. */
export const ORDER_NOTE_MAX_LENGTH = 2000;

/** "Allegro", "Allegro or PrestaShop", "Allegro, Erli or PrestaShop". */
function joinWithOr(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export const ORDER_NOTES_COPY = {
  heading: (count: number) => (count > 0 ? `Notes (${count})` : 'Notes'),
  privacy: (channelNames: readonly string[]) =>
    `Only your team sees these. Never sent to ${
      channelNames.length > 0 ? joinWithOr(channelNames) : 'your sales channels'
    }.`,
  privacyShort: 'Only your team sees these.',
  readOnly: 'You can read notes. Adding or changing them needs the operator or admin role.',
  loadingTitle: 'Loading notes',
  loadingMessage: 'Fetching the notes for this order…',
  loadErrorTitle: 'Notes not loaded',
  loadErrorMessage: 'OpenLinker could not load the notes for this order.',
  retry: 'Try again',
  emptyTitle: 'No notes yet',
  emptyMessage:
    "Write down anything the next person handling this order should know: a buyer's request, a phone call, a packing instruction.",
  listLabel: 'Notes',

  composer: {
    label: 'New note',
    placeholder: 'Add a note for your team',
    showToPacker: 'Show to packer on the pack bench',
    pinToTop: 'Pin to the top',
    counter: (length: number) => `${length} / ${ORDER_NOTE_MAX_LENGTH}`,
    submit: 'Add note',
    packerWarning:
      'Packers see this text on the pack bench. Leave out phone numbers, emails and addresses.',
    saveErrorTitle: 'Note not saved',
    saveErrorFallback: 'OpenLinker could not reach the server.',
    saveErrorTail: 'Your text is still in the box above.',
    retry: 'Try again',
    pinErrorTitle: 'Note added, not pinned',
    pinErrorFallback: 'OpenLinker could not pin the note. Pin it from the list.',
  },

  row: {
    edited: 'edited',
    pinned: 'Pinned',
    shownToPacker: 'Shown to packer',
    edit: 'Edit',
    pin: 'Pin',
    unpin: 'Unpin',
    delete: 'Delete',
    editLabel: 'Edit note',
    save: 'Save',
    cancel: 'Cancel',
    editHint: 'Everyone sees that it was edited.',
    editErrorTitle: 'Edit not saved',
    editErrorFallback: 'OpenLinker could not save the edit. Try again.',
    actionErrorTitle: 'Note not changed',
    actionErrorFallback: 'OpenLinker could not change the note. Try again.',
  },

  deleteDialog: {
    title: 'Delete this note?',
    descriptionLead:
      'The text is removed for everyone, including the pack bench. The activity timeline keeps a line saying a note by',
    descriptionTail: 'was deleted, without its text.',
    keep: 'Keep note',
    confirm: 'Delete note',
    errorTitle: 'Note not deleted',
    errorFallback: 'OpenLinker could not delete the note. Try again.',
  },

  pinned: {
    label: 'Pinned note',
    allNotes: (count: number) => `All notes (${count})`,
  },

  timeline: {
    created: 'Note added',
    edited: 'Note edited',
    shownToPacker: 'Note shown to packer',
    hiddenFromPacker: 'Note hidden from packer',
    deleted: 'Note deleted',
    unknown: (kind: string) => `Note changed (${kind})`,
    packerFooter: 'Shown to packer on the pack bench',
    deletedDescription: 'The text was removed.',
  },
} as const;
