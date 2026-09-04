/**
 * Pack-bench parcel and document copy (#2418, `W3b-5`, stories D1–D4, E1–E6, F1–F4)
 *
 * One copy source for the box, its refusals, and the paper that travels with it.
 *
 * ## What this copy is NOT allowed to say
 *
 * - **Never that a box is done because a control was pressed** (D18/E5). There
 *   is no commit control on this surface, so no string here may promise one, and
 *   the footer says so to the packer in as many words. `bench-parcel.test.tsx`
 *   fails on any button whose accessible name reads like a commit.
 * - **Never that a line was confirmed by hand** (D20). There is no such string
 *   in this file, and there must never be one: marking a hand-confirm creates a
 *   stigma, and the stigma drives the workaround the model cannot detect —
 *   scanning a second unit of the same code twice. The two paths render the same
 *   words because they are the same act.
 * - **Never that the bench issued a document** (F1). The bench prints what was
 *   made earlier, elsewhere. A missing invoice is never something to retry here.
 * - **Never the nine banned terms.** `scripts/check-ui-vocabulary.mjs` scans
 *   every string literal in this file.
 * - **Never a fact the API does not carry.** The mockup shows a label's
 *   *"fetched 14:29"* and *"tried 3 times"*; `Shipment` holds neither, so no
 *   string here invents them. Recorded in the mockups' own README.
 *
 * @module apps/web/src/features/bench/lib
 */

export const benchParcelCopy = {
  header: {
    orderLabel: 'Order',
    buyerLabel: 'Buyer',
    /** D3. Always shown, on every state of this surface. */
    parcelOf: (index: number, total: number): string =>
      `Parcel ${String(index)} of ${String(total)}`,
    /** D3's second half: one box's contents are never presented as the order. */
    thisBoxOnly:
      'Everything below belongs in this box only. The other boxes of this order are being handled somewhere else.',
    progress: (verified: number, required: number): string =>
      `${String(verified)} of ${String(required)} units scanned`,
    backAction: 'Back to the list',
  },

  lines: {
    /**
     * The per-line summary. ONE builder for every line, whichever way its units
     * were confirmed — see the module docblock.
     */
    count: (verified: number, required: number): string =>
      `${String(verified)} of ${String(required)}`,
    stillToScan: (remaining: number): string =>
      remaining === 1 ? '1 still to scan' : `${String(remaining)} still to scan`,
    noneYet: 'not scanned yet',
    allIn: 'all in',
    noMoreFit: 'no more fit',
    /** Rendered when the variant is not in the catalogue — the codes stand in. */
    unnamed: 'No product name recorded',
    codes: (parts: { readonly ean: string | null; readonly sku: string | null }): string =>
      [parts.ean === null ? null : `EAN ${parts.ean}`, parts.sku === null ? null : `SKU ${parts.sku}`]
        .filter((part): part is string => part !== null)
        .join(' · '),
    badgeVerified: 'Verified',
    badgeScanning: 'Scanning now',
    badgeNotScanned: 'Not scanned yet',
    matchedHeading: 'Matched · in the box',
    /**
     * E4. Named for what it does — confirm this line — and never for how. There
     * is deliberately no second word anywhere that would let a reader, or a
     * screenshot, tell the two paths apart afterwards.
     */
    confirmAction: 'Confirm this line',
    confirmHint: 'For an item whose barcode is damaged, missing or will not read.',
  },

  verify: {
    /** E2, naming what it expected and what it got. Nothing was recorded. */
    wrongItemTitle: 'That item does not belong in this box',
    wrongItemBody: (parts: { readonly scanned: string; readonly expected: readonly string[] }): string =>
      parts.expected.length === 0
        ? `Nothing was recorded. This box has nothing left to scan, so ${parts.scanned} cannot go in it.`
        : `Nothing was recorded. This box is still waiting for ${parts.expected.join(', ')} — you scanned ${parts.scanned}.`,
    scannedLabel: 'Scanned',
    /** E3, verbatim from the mockup with the numbers filled in. */
    overPacked: (parts: { readonly required: number; readonly kept: number }): string =>
      `Third scan turned down — this box takes ${String(parts.required)}. The count stayed at ${String(parts.kept)}. The bench beeped.`,
    overPackedBadge: 'Extra scan refused',
    notPackable: 'Nothing was recorded. This box must not be packed — take it back to the trolley.',
    parcelClosed:
      'Nothing was recorded. This box is already closed. Reopen it first if something needs changing.',
    noSuchLine:
      'Nothing was recorded. That line is not part of this box any more. The screen has been refreshed.',
    /** A refusal this build does not recognise. Never silently swallowed. */
    unknownRefusal:
      'Nothing was recorded, and this bench cannot say why. Show this screen to your supervisor.',
    failedTitle: 'That did not go through',
    failedBody:
      'Nothing was recorded. Scan the item again — a scan that did not reach us is never counted twice.',
    dismissAction: 'Dismiss',
  },

  /** D2 — the same eligibility rule the list uses, said the same way. */
  refusal: {
    heldTitle: 'On hold — do not pack this box',
    heldBody: 'Put the tote back on the trolley. Nothing in it can be scanned while it is on hold.',
    cancelledTitle: 'Cancelled — nothing to pack',
    cancelledBody: 'Take the items back to the shelf. This box is not going out.',
    unknownTitle: 'This box must not be packed',
    unknownBody:
      'Put the tote back on the trolley. This bench cannot say more than that — show this screen to your supervisor.',
    reasonLabel: 'Reason given',
  },

  /**
   * D4/D21 — the interrupt, and ONLY when the box becomes unpackable.
   *
   * It never fires for a buyer's address, a re-priced line or any other change:
   * an interruption that goes off for those trains people to dismiss
   * interruptions, and then the one that matters is dismissed too.
   */
  interrupt: {
    heldTitle: 'This box has just been put on hold',
    cancelledTitle: 'This order has just been cancelled',
    unknownTitle: 'This box can no longer be packed',
    body: 'It changed while you were packing it. Stop scanning, put the tote back on the trolley, and open the next parcel.',
    acknowledgeAction: 'Back to the list',
  },

  closed: {
    title: 'This box is closed',
    summary: (parts: {
      readonly orderReference: string;
      readonly index: number;
      readonly total: number;
    }): string =>
      `${parts.orderReference} · Parcel ${String(parts.index)} of ${String(parts.total)}`,
    /** E5/D18, said plainly: nothing was pressed, because there was nothing to press. */
    body: (units: number): string =>
      `All ${String(units)} units matched. The last scan closed it — there was nothing to press.`,
    next: 'The next parcel opens here by itself. Scan its first item when you are at that box.',
    /** E6. Offered on this state and nowhere else. */
    reopenAction: 'Reopen this box',
    reopenHint:
      'Only if it closed by mistake. Every unit is cleared and you scan the box again from the start.',
    reopenedNotice: 'The box is open again. Every unit was cleared — scan them all back in.',
    reopenShipped:
      'This box has already gone. It cannot be reopened here, because the goods are not in the building any more.',
    reopenNotClosed: 'This box is not closed, so there is nothing to reopen. Carry on scanning.',
    reopenUnknownRefusal:
      'The box was not reopened, and this bench cannot say why. Show this screen to your supervisor.',
    reopenFailed: 'That did not go through. Nothing changed — try again.',
  },

  /** E5's promise, rendered on the verifying surface. */
  footer: {
    noCommit:
      'This box closes itself the moment the last line is verified. There is nothing here to press.',
    scannerReady: 'Scanner in · keyboard not needed',
  },

  loading: {
    title: 'Opening this parcel',
    body: 'One moment.',
  },
  errors: {
    loadTitle: 'Could not open this parcel',
    retryAction: 'Try again',
  },

  // ── Surface F ────────────────────────────────────────────────────────────
  documents: {
    insideLabel: 'Goes INSIDE the box',
    insideLabelMissing: 'Would go INSIDE the box',
    onLabel: 'Goes ON the box',
    readyBadge: 'Ready to print',
    nothingToPrintBadge: 'Nothing to print',
    readyTitle: 'Both papers are waiting to print',
    readyBody:
      'They were both made earlier, away from this bench. Printing them here does not create anything.',
    printInvoiceAction: 'Print invoice',
    printLabelAction: 'Print label',
    invoiceHint: 'Fold it once and drop it in on top of the goods, before you tape the box.',
    labelHint: 'Stick it flat on the largest side. Cover nothing else with it.',
    invoiceTitle: (number: string | null): string =>
      number === null ? 'Invoice for this order' : `Invoice ${number}`,
    labelTitle: (carrier: string | null): string =>
      carrier === null ? 'Label for this box' : `${carrier} label`,
    trackingLabel: 'Tracking',
    printFailed: 'That did not print. Nothing changed — try again.',

    /** F1's honest exception: the document exists but only as machine-readable source. */
    notPrintableTitle: 'There is nothing to print for this one',
    notPrintableBody:
      'An invoice was made for this order, but it only exists in a form a printer cannot use. Send the box without it — the office will post it to the buyer.',

    /** F2 — named, never silently skipped, and never blocking. */
    missingTitle: 'Carry on packing — one paper is not coming',
    missingBody:
      'This is not something you can fix at the bench, and it does not stop the box going out.',
    missingInvoiceTitle: 'No invoice was made for this order',
    missingInvoiceBody:
      'There is nothing to put in the box. Send it without one. The office will post it to the buyer afterwards.',
    missingReasonLabel: 'What the office will see',
    /** Said when nothing recorded a reason — itself an answer, not a gap to fill in. */
    missingReasonUnknown: 'Nothing on this order says why. The office has it on their list either way.',
    flaggedTitle: 'This one is flagged for the office.',
    flaggedBody:
      'It is already on their list of orders that went out without a document — you do not need to tell anyone or write it down.',
  },

  /** F3/F4 — packed, and it cannot go out. */
  unlabelled: {
    eyebrow: 'This box cannot go out',
    title: 'Packed, but there is no label',
    body: (units: number): string =>
      `The box is finished and correct — all ${String(units)} units matched and it is closed. The carrier would not give us a label for it, so there is nothing to stick on. Do not open it and do not check it again.`,
    badge: 'Packed · no label',
    carrierHeading: 'What the carrier said',
    /**
     * The carrier's own words, when we were given them. `carrierMessage` is
     * `null` for a packer — the raw rejection text may embed address fragments —
     * so the short code stands in, and where there is neither we say so rather
     * than rendering an empty quotation.
     */
    carrierQuote: (message: string): string => `“${message}”`,
    carrierCode: (code: string): string => `The carrier turned it down with code ${code}.`,
    carrierUnknown: 'The carrier did not say why.',
    /**
     * DIFFERENT from `carrierUnknown`, and the difference matters: a packer
     * never sees the carrier's own words, so telling them the carrier said
     * nothing — when it did — would be this screen stating something false.
     */
    carrierHidden: 'The carrier gave a reason, but it is not shown at the bench.',
    carrierReassurance:
      'Nothing about the box is wrong. Somebody needs to choose a different collection point or a courier, and then the label will print.',
    /**
     * F4, answered honestly. There is no "try again" at this bench for a label
     * that was never produced — buying one needs the address and the box
     * measurements, which are not on this screen. A label that EXISTS is
     * reported `ready` instead, and pressing Print there re-fetches it.
     */
    notRetryable:
      'There is nothing to try again from this bench. Buying a label needs the address and the box measurements, which are not on this screen — dispatch does it.',
    dispatchTitle: 'Dispatch can see this box too',
    dispatchBody:
      'It sits on the dispatch list of boxes waiting for a label until one prints, so it does not depend on anyone remembering this bench. If you leave now, the box stays on that list.',
    /** The mockup's counts line, from `GET /bench/unlabelled-parcels`. */
    counts: (parts: { readonly here: number; readonly inDispatch: number }): string =>
      `${String(parts.here)} box waiting here · ${String(parts.inDispatch)} in dispatch`,
    invoiceStillFine:
      'The invoice is fine and can go in the box now, so it is not missing later.',
  },
} as const;
