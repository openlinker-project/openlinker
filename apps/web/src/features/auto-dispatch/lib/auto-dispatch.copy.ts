/**
 * Automatic shipping labels - copy (#2729)
 *
 * Every operator-facing sentence of the section, in one file so the form, the
 * refusal list and the preview cannot drift apart.
 *
 * A reason is stated as what is wrong AND what to do about it, because the
 * operator reading "no-weight" cannot act on a code.
 *
 * @module apps/web/src/features/auto-dispatch/lib
 */
import type {
  AutoDispatchPreviewRefusal,
  AutoDispatchRefusalCode,
  AutoDispatchTrigger,
} from '../api/auto-dispatch.types';

export const autoDispatchCopy = {
  section: {
    title: 'Automatic shipping labels',
    intro:
      'Buy the shipping label for you, so a packer only has to print and pack. This changes nothing until fulfilment routing is on and this connection is the one doing the packing.',
    enabled: 'Buy labels automatically',
    triggerLegend: 'When the label is bought',
    saveFailedTitle: 'Settings not saved',
    saved: 'Automatic label settings saved.',
    save: 'Save settings',
    saving: 'Saving…',
    revert: 'Discard changes',
    loading: 'Reading the current settings…',
    loadFailedTitle: 'Could not read the current settings',
    retry: 'Try again',
    readOnly: 'You can see these settings, but you do not have permission to change them.',
    unrecognisedTrigger:
      'The saved moment is not one this version knows, so it is read as "When the task is accepted". Choose one below and save to replace it.',
  },
  triggers: {
    'on-accept': {
      label: 'When the task is accepted',
      description: 'The label is bought as soon as OpenLinker accepts the order for packing.',
    },
    'on-parcel-closed': {
      label: 'When the parcel is closed at the bench',
      description:
        'The label is bought when the last item is scanned and the box closes itself. Nothing is bought at acceptance.',
    },
  } satisfies Record<AutoDispatchTrigger, { label: string; description: string }>,
  parcel: {
    legend: 'Parcel defaults',
    help: 'Used when OpenLinker has to decide the parcel itself. A weight on the product wins over these.',
    weight: 'Fallback weight per unit (g)',
    weightHelp:
      'Used for a product that has no weight of its own. Leave it empty if every product has one.',
    weightEmptyNote:
      'With no fallback weight, an order containing a product without a weight is refused, not guessed.',
    template: 'Size template',
    templateHelp: 'The carrier’s size code, for example "small". Leave empty if the carrier takes a box.',
    box: 'Default box (mm)',
    boxHelp: 'For a carrier that needs explicit dimensions. Set all three or none.',
    length: 'Length',
    width: 'Width',
    height: 'Height',
  },
  refusals: {
    title: 'Recent refusals',
    help: 'Orders where an automatic label was not bought, and why.',
    needsInput: 'Needs your input',
    needsInputHelp: 'Nothing changes until someone acts.',
    retrying: 'Retrying automatically',
    retryingHelp: 'Still being retried; it may clear on its own.',
    emptyTitle: 'No refusals',
    emptyBody: 'Every recent order that reached this point got its label.',
    emptyBucket: 'Nothing here.',
    loadFailedTitle: 'Could not read the refusals',
    unreadable: 'The refusal list came back in a shape this version cannot read.',
    order: 'Order',
    reason: 'Reason',
    when: 'When',
    attempts: (attempts: number, max: number): string => `Attempt ${String(attempts)} of ${String(max)}`,
    openOrder: 'Open order',
    codes: {
      'not-enabled': 'Automatic labels were switched off when this ran.',
      'no-weight': 'A product has no weight and there is no fallback weight. Set one above.',
      'no-dimensions': 'The carrier needs a box size and none is set. Set a default box above.',
      'no-address': 'The order has no deliverable address, e-mail or phone. Fix the order.',
      'no-delivery-method': 'The connected carrier cannot ship this delivery method.',
      'work-not-eligible': 'The order is on hold or not paid yet.',
      'shipment-claimed-by-sibling-work':
        'Another parcel of this order already has a label. Buy this one by hand.',
      'payload-invalid': 'The label request was malformed.',
      'carrier-refused': 'The carrier did not accept the label.',
      unknown: 'A reason this version does not recognise.',
    } satisfies Record<AutoDispatchRefusalCode, string>,
  },
  preview: {
    title: 'Try these settings on recent orders',
    help: 'Shows which recent orders would get a label with the values above, before you save. Nothing is bought and nothing is saved.',
    run: 'Preview',
    running: 'Checking…',
    failedTitle: 'Could not run the preview',
    unreadable: 'The preview came back in a shape this version cannot read.',
    empty: 'This connection has no recent orders to preview yet.',
    order: 'Order',
    weight: 'Weight',
    template: 'Template',
    box: 'Box',
    result: 'Result',
    wouldLabel: 'Gets a label',
    refused: 'Would be refused',
    summary: (labelled: number, refused: number): string =>
      `${String(labelled)} would get a label, ${String(refused)} would be refused.`,
    none: '—',
    reasons: {
      'no-weight': 'No weight on the product and no fallback weight',
      'no-address': 'No deliverable address, e-mail or phone',
      'no-dimensions': 'The carrier needs a box size',
      'order-unreadable': 'The order could not be read',
    } satisfies Record<AutoDispatchPreviewRefusal, string>,
  },
} as const;
