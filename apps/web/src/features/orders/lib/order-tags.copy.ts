/**
 * Order tags — operator-facing copy (#3532/#3533, mockup M3)
 *
 * One place for every sentence the tag chip, picker, bulk menu and the
 * Settings tag manager say, so the mockup's wording is reviewable in one file
 * and the e2e selectors that key on it have one source.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderTagColorValue } from '../api/orders.types';

/** Mockup M3 `tags`: "Up to 32 characters. Must be unique." */
export const ORDER_TAG_NAME_MAX_LENGTH = 32;

/** D34 — the workspace vocabulary cap, mirrored for the "N of 50" line only. */
export const ORDER_TAG_LIMIT = 50;

/** The colour radiogroup and the manager's Colour column name each swatch. */
export const ORDER_TAG_COLOR_LABELS: Record<OrderTagColorValue, string> = {
  grey: 'Grey',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  pink: 'Pink',
  violet: 'Violet',
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export const ORDER_TAGS_COPY = {
  headerLabel: 'Tags',
  noTags: 'No tags',
  addTag: '+ Add tag',
  removeTag: (name: string) => `Remove tag ${name}`,
  /** `+N` on the list row's tags line names what it hides. */
  moreTags: (names: readonly string[]) =>
    `${names.length} more ${plural(names.length, 'tag', 'tags')}: ${names.join(', ')}`,

  picker: {
    dialogLabel: 'Add tag',
    searchPlaceholder: 'Find or create a tag',
    listLabel: 'Tags',
    createRow: (name: string) => `+ Create “${name}”`,
    emptyVocabulary: 'No tags yet. Type a name to create the first tag.',
    manageTags: 'Manage tags',
    savedHint: 'Saved as you tick',
    done: 'Done',
    createdToastTitle: 'Tag created and added',
    createdToastDescription: (name: string) => `${name} is on this order now.`,
    createErrorTitle: 'Tag not created',
    createErrorFallback: 'OpenLinker could not create the tag. Try again.',
    saveErrorTitle: 'Tag not saved',
    saveErrorFallback: 'OpenLinker could not save the change. Try again.',
  },

  bulk: {
    trigger: 'Tags',
    menuLabel: 'Tags for selected orders',
    heading: (count: number) => `Add tag to ${count} ${plural(count, 'order', 'orders')}`,
    hasIt: (has: number, of: number) => `${has} of ${of} ${plural(has, 'has', 'have')} it`,
    allHaveIt: 'All have it',
    emptyVocabulary: 'No tags yet.',
    manageTags: 'Manage tags',
    resultTitle: 'Tag added',
    resultDescription: (name: string, added: number, alreadyTagged: number) =>
      `${name} added to ${added} ${plural(added, 'order', 'orders')}.` +
      (alreadyTagged > 0 ? ` ${alreadyTagged} already had it.` : ''),
    errorTitle: 'Tag not added',
    errorFallback: 'OpenLinker could not add the tag. Try again.',
  },

  manager: {
    eyebrow: 'Settings',
    title: 'Order tags',
    description:
      'Labels your team puts on orders. Use them to filter the order list and to mark orders in bulk. Tags stay in OpenLinker and are never sent to your sales channels.',
    adminOnly: 'This page needs the admin role.',
    newTag: 'New tag',
    newTagMeta: 'Admins only',
    nameLabel: 'Name',
    nameHint: `Up to ${ORDER_TAG_NAME_MAX_LENGTH} characters. Must be unique.`,
    nameCounter: (length: number) => `${length} / ${ORDER_TAG_NAME_MAX_LENGTH}`,
    colourLegend: 'Colour',
    preview: 'Preview',
    previewPlaceholder: 'Tag name',
    cancel: 'Cancel',
    create: 'Create tag',
    createdToastTitle: 'Tag created',
    createdToastDescription: (name: string) => `${name} is ready to use on orders.`,
    createErrorTitle: 'Tag not created',
    tableCaption: 'Order tags',
    columnTag: 'Tag',
    columnColour: 'Colour',
    columnOrders: 'Orders',
    columnCreated: 'Created',
    columnActions: 'Actions',
    edit: 'Edit',
    save: 'Save',
    delete: 'Delete',
    loading: 'Loading tags',
    loadingMessage: 'Fetching the workspace tag vocabulary…',
    emptyTitle: 'No tags yet',
    emptyMessage: 'Create the first tag here, or from the tag picker on any order.',
    usage: (count: number) => `${count} of ${ORDER_TAG_LIMIT} tags used.`,
    deleteTitle: (name: string) => `Delete tag “${name}”?`,
    deleteDescriptionLead: 'It is taken off',
    deleteDescriptionTail: (count: number) =>
      `${plural(count, 'order', 'orders')}. The orders themselves do not change, and nothing is sent to your sales channels. This cannot be undone.`,
    keepTag: 'Keep tag',
    deleteTag: 'Delete tag',
    deleteErrorTitle: 'Tag not deleted',
    saveErrorTitle: 'Tag not saved',
  },
} as const;
