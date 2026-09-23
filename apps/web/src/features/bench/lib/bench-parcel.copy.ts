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
    parcelLabel: 'Parcel',
    /** #3409 (epic #3401) — a deliberate reversal of the original PII exclusion. */
    totalLabel: 'Order total',
    carrierLabel: 'Carrier',
    dispatchByLabel: 'Ship by',
    /** D3. Always shown, on every state of this surface. */
    parcelOf: (index: number, total: number): string =>
      `Parcel ${String(index)} of ${String(total)}`,
    /** #3418 (epic #3401) — the order-head's own status pill, one per state. */
    statusInProgress: 'In progress',
    statusHeld: 'On hold',
    statusCancelled: 'Cancelled',
    statusPacked: 'Packed',
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
    /** The mockup's own caption above the item list. */
    allItemsCaption: 'All items in this parcel',
    groupByLocationLabel: 'Group by bin',
    groupByLocationNote: 'Sorts this box\u2019s own items by bin.',
    colItem: 'Item',
    colIdentifiers: 'Identifiers',
    colLocation: 'Location',
    colScanned: 'Scanned',
    colStatus: 'Status',
    badgeVerified: 'Verified',
    badgeScanning: 'Scanning now',
    badgeNotScanned: 'Not scanned yet',
    matchedHeading: 'Matched · in the box',
    /**
     * E4. Named for what it does — confirm this item — and never for how. There
     * is deliberately no second word anywhere that would let a reader, or a
     * screenshot, tell the two paths apart afterwards.
     */
    confirmAction: 'Confirm this item',
    /**
     * The same act, named for a screen reader so several rows' buttons are not
     * all announced identically. Never rendered on screen — see the `aria-label`
     * in `bench-parcel-line.tsx` for why the visible text stays uniform.
     */
    confirmActionFor: (item: string): string => `Confirm ${item}`,
    confirmHint: 'For an item whose barcode is damaged, missing or will not read.',
    /**
     * The variant's attributes, one line (#3417, mockup-parity epic #3401).
     * Sorted by key so the same variant always reads the same way.
     *
     * The NAME is rendered beside the value, not dropped. This shipped as
     * values-only on the assumption that a variant's attributes are the
     * distinguishing ones — colour, size — where "Red · M" reads perfectly.
     * Real catalogue data is not like that: a live PrestaShop product here
     * carries `{Wariant: "…50ml", "Reklamowany w TV": "tak", "Kosmetyk
     * ekskluzywny": "tak", "Produkt dla mężczyzn": "tak"}`, which rendered as
     * `tak · tak · tak · …` — three identical words that tell a packer holding
     * the box precisely nothing.
     *
     * A value with no name is only readable when the name is obvious from the
     * value, and nothing guarantees that. Naming it costs a few characters and
     * always reads.
     */
    attributesText: (attrs: Record<string, string>): string =>
      Object.keys(attrs)
        .sort()
        .map((key) => `${key}: ${attrs[key] ?? ''}`)
        .join(' · '),
    /** Operator-authored bin/shelf code, rendered as a short label (#3402/#3410). */
    binCodeLabel: (code: string): string => `Bin ${code}`,
    /** Display-only physical master data — never a claim OpenLinker measured it. */
    weightGrams: (grams: number): string =>
      grams >= 1000 ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1)} kg` : `${String(grams)} g`,
    dimensionsMm: (lengthMm: number, widthMm: number, heightMm: number): string =>
      `${String(lengthMm)} × ${String(widthMm)} × ${String(heightMm)} mm`,
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
    /** ADR-074 / #3336 / #3337 / #3341 — the assignment-lock refusal. */
    assignedToAnotherPacker: 'Nothing was recorded. This box is assigned to another packer.',
    parcelClosed:
      'Nothing was recorded. This box is already closed. Reopen it first if something needs changing.',
    noSuchLine:
      'Nothing was recorded. That item is not part of this box any more. The screen has been refreshed.',
    /** A refusal this build does not recognise. Never silently swallowed. */
    unknownRefusal:
      'Nothing was recorded, and this bench cannot say why. Show this screen to your supervisor.',
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
    /** ADR-074 / #3336 / #3337 / #3341 — the assignment-lock refusal. */
    reopenAssignedToAnotherPacker: 'This box could not be reopened — it is assigned to another packer.',
    reopenUnknownRefusal:
      'The box was not reopened, and this bench cannot say why. Show this screen to your supervisor.',
    reopenFailed: 'That did not go through. Nothing changed — try again.',
  },

  /**
   * Pack-bench completion — the second, explicit act after a box closes.
   * Closing (the last scan) says the ITEMS are right; this says the PACKER
   * has finished with the box. Offered only on a closed box, and distinct
   * from the no-commit rule above: that rule is about the box's CONTENTS
   * having nothing to press, not about this later question, which has a real
   * control and a real write behind it.
   *
   * ## Why this says "off the bench" and never "sent" or "on the trolley"
   *
   * The earlier wording claimed the box was labelled and on its way, which is
   * false on a box the carrier refused a label for — `BenchDocumentsPanel`
   * says so, four lines above this control, in the same breath as "this box
   * cannot go out". A packer pressing the button had just told the office
   * something untrue. "Off the bench" is true either way: it records that
   * THIS PACKER is finished with the box, never that a carrier accepted it —
   * an unlabelled box legitimately leaves the bench for a dispatch queue, and
   * `completedAt` is the packer's act, not a claim about the carrier's. See
   * `BenchCompletionPanel`'s own docblock.
   */
  completion: {
    action: 'Mark as done here',
    hint: "This tells the office you're finished with this box — it's off your bench now.",
    doneNotice: (formattedAt: string): string => `Marked done at ${formattedAt}.`,
    confirmTitle: 'Before you mark it done',
    /** Named for WHAT is missing, never a bare "are you sure". */
    confirmBodyBoth: 'Neither the label nor the invoice for this box has been printed yet.',
    confirmBodyLabel: 'The label for this box has not been printed yet.',
    confirmBodyInvoice: 'The invoice for this box has not been printed yet.',
    /**
     * Read live off the current parcel, so if the packer prints from inside
     * this dialog, the sentence catches up rather than keeping the gap it
     * opened with.
     */
    confirmBodyNoneLeft: 'Both papers are printed now.',
    confirmHint: 'Print them now, or go ahead if you already printed them somewhere else.',
    printInvoiceAction: 'Print the invoice',
    printLabelAction: 'Print the label',
    printFailed: 'That did not print. Try again, or go ahead anyway.',
    confirmAction: 'Mark as done anyway',
    cancelAction: 'Not yet',
    refusedNotClosed: 'This box is not closed yet, so there is nothing to mark done. Carry on scanning.',
    refusedAlreadyCompleted: 'This box was already marked done.',
    refusedStale: 'Somebody else changed this box. This screen now shows the latest — try again.',
    refusedLocked:
      'This box is assigned to someone else right now, so it cannot be marked done from here.',
    refusedUnknown:
      'That did not go through, and this bench cannot say why. Show this screen to your supervisor.',
    failed: 'That did not go through. Nothing changed — try again.',
  },

  /** E5's promise, rendered on the verifying surface. */
  footer: {
    noCommit:
      'This box closes itself the moment the last item is verified. There is nothing here to press.',
    scannerReady: 'Scanner in · keyboard not needed',
    /**
     * The "C" shortcut has no visible control of its own to attach a hint
     * to — unlike every other affordance on this surface, which is a
     * button (#3339 review). Stated here rather than left undiscoverable.
     */
    keyboardHint: 'Not scanning? Press C to confirm the next open item by hand.',
  },

  /** #3411 (epic #3401) — recent activity, newest first. */
  activity: {
    heading: 'Recent activity',
    verified: 'verified',
    undone: 'undone',
  },

  /**
   * #3405 (epic #3401) — undo the single most recent scan, whichever line it
   * landed on. A lighter correction than reopen: it never touches a closed
   * box.
   */
  undo: {
    action: 'Undo last scan',
    voidedNotice: (name: string | null): string =>
      `Undone — the last unit on ${name ?? 'that line'} no longer counts.`,
    nothingToUndo: 'Nothing to undo yet.',
    parcelClosed: 'This box already closed. Reopen it first.',
  },

  /**
   * H2 — the running answer to *"did my last scan count?"* (#2421)
   *
   * Read by ONE `aria-live="polite"` region, so a packer who cannot see the
   * screen still gets a spoken answer for every gesture. Refusals are
   * deliberately absent from this table: `Alert tone="error"` already renders
   * `role="alert"`, so announcing them here too would say each refusal twice.
   *
   * `sent` is the state the surface had no words for at all before this issue.
   * Under D18 the box closes on the system's own count, so a packer reading an
   * optimistic screen never reaches a moment where the two are compared — which
   * is why the in-flight state is named rather than papered over with a tick
   * that arrives early.
   */
  /**
   * The hero scan card (mockup-parity epic #3401).
   *
   * Says outright that scanning needs no button, because the previous
   * surface had no visible field at all and a packer could not tell whether
   * their reader was reaching the screen. `confirmAction` is named for what
   * it does and never for how — the same rule `lines.confirmAction` follows,
   * and for the same D20 reason.
   */
  /** The mockup's `.copy-btn`, beside the order reference and the hero's EAN. */
  /**
   * #3406 — the mockup's collision banner. Advisory, never a lock: both
   * packers keep scanning and the counts are one count. The copy says that in
   * as many words, because the packer's instinct on seeing a colleague's name
   * is to stop, and stopping is the wrong move.
   */
  /**
   * The phone and tablet bench (mobile-first rebuild, epic #3401).
   *
   * Every string here is about the packer's own hands: what to point the
   * camera at, which item the count belongs to, and what to do when the
   * device cannot read a barcode at all. Nothing here promises a camera on a
   * browser that has no decoder - `cameraUnsupported` says which path is
   * left instead, because a control that cannot work is worse than none.
   */
  mobile: {
    scanAction: 'Scan with camera',
    scanClose: 'Close the camera',
    torch: 'Torch',
    aim: 'Hold the barcode inside the frame',
    keepScanning: 'Keep scanning - the camera stays open until this item is done.',
    lastRead: 'Read',
    cameraUnsupported:
      'This browser cannot read a barcode from the camera. Type the code instead - it counts exactly the same.',
    cameraNoDevice: 'No camera on this device. Type the code instead.',
    cameraDenied:
      'The camera is blocked for this page. Allow it in your browser settings, or type the code instead.',
    cameraFailed: 'The camera did not start. Try again, or type the code instead.',
    /** The accordion handle, collapsed. */
    itemOf: (index: number, total: number): string =>
      `Item ${String(index)} of ${String(total)}`,
    itemsHeading: 'Items in this box',
    switchParcel: 'Switch to another parcel',
    closeList: 'Back to the box',
    /** Said on the handle so the packer knows what opening it costs them. */
    stillToScanShort: (remaining: number): string =>
      remaining === 1 ? '1 left' : `${String(remaining)} left`,
    allItemsDone: 'All items scanned',
  },

  collision: {
    title: 'Someone else has this box open too',
    body: (names: readonly string[]): string => {
      const who =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
      const verb = names.length === 1 ? 'is' : 'are';
      return `${who} ${verb} scanning this box as well. Your scans and theirs are counted together, so carry on - just do not both go hunting for the same missing unit.`;
    },
  },

  copy: {
    action: (what: string): string => `Copy ${what}`,
    copied: (what: string): string => `${what} copied`,
    orderReference: 'order reference',
    barcode: 'barcode',
  },

  hero: {
    scanLabel: 'Scan this item',
    /** The mockup's transient `✓ Matched`. Announced separately by the live region. */
    matched: 'Matched',
    scanPlaceholder: 'Scan or type SKU / EAN, then press Enter',
    confirmAction: 'Confirm this item',
    scanHint: 'Scanning counts on its own. Confirm by hand only when a barcode will not read.',
    keyboardHint: 'C confirm · U undo · Esc back to the scan box',
    countOf: (required: number): string => `of ${String(required)}`,
    /** The progress bar's own right-hand figure. */
    percent: (value: number): string => `${String(value)}%`,
  },

  inFlight: {
    sent: 'Sent — waiting for the system',
    sentAnnouncement: (name: string): string => `${name} sent. Waiting for the system.`,
    recordedAnnouncement: (parts: {
      readonly name: string;
      readonly verified: number;
      readonly required: number;
    }): string =>
      `${parts.name} counted. ${String(parts.verified)} of ${String(parts.required)}.`,
    /**
     * The unit is neither in nor out until the server answers. Said in those
     * words because the packer's next act depends on it: scan the same item
     * again, which the per-gesture id makes safe.
     */
    unresolved: (name: string): string =>
      `${name} was sent and we have no answer yet. It is not counted. Scan the same item again — one scan is never counted twice.`,
    unresolvedTitle: 'That scan has no answer yet',
  },

  /**
   * H1 — said plainly, and claiming only what the bench can know. (#2421)
   *
   * Never "you are offline": one failed request establishes nothing about the
   * packer's network, and the two signals behind this state (a request with no
   * answer, and the browser reporting its own link down) have one honest
   * sentence between them.
   */
  unreachable: {
    title: 'This bench cannot reach OpenLinker',
    body: 'Everything already counted is safe — nothing you scanned has been lost. New scans are turned down until the bench is back, because a scan it cannot record is a scan that did not happen.',
    whatToDo: 'Stop scanning and wait. This clears by itself the moment the bench gets through.',
    refusedTitle: 'Not counted — the bench cannot reach OpenLinker',
    refusedBody:
      'Nothing was recorded. Wait for the message above to clear, then scan this item again.',
    badge: 'No connection',
    confirmDisabledHint: 'Not while the bench is out of touch with OpenLinker.',
  },

  /** C4 — sound is an addition to the visible signal, and it can be turned off. */
  audio: {
    onLabel: 'Sound on',
    offLabel: 'Sound off',
    muteAction: 'Turn the sound off',
    unmuteAction: 'Turn the sound on',
    hint: 'Refusals are always shown on screen. The sound is extra, for when you are looking at the box.',
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
    /**
     * Deliberately does NOT name the carrier.
     *
     * `Shipment.carrier` holds the adapter's own key — `inpost`, lowercase —
     * so interpolating it printed `inpost label` at a packer, an internal
     * identifier dressed as a sentence. Title-casing it would produce
     * `Inpost`, which is a different wrong answer, and no display-name map
     * exists to look the real one up in.
     *
     * Nothing is lost by leaving it out: the order head one row above already
     * names the carrier correctly, from the SOURCE's own delivery-method label
     * ("InPost Paczkomat"), and the tracking number sits directly under this
     * heading. The carrier arrives here only to be recorded, not rendered.
     */
    labelTitle: (): string => 'Label for this box',
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
    missingInvoiceBody: 'There is nothing to put in the box. Send it without one.',
    missingReasonLabel: 'Why',
    /** Said when nothing recorded a reason — itself an answer, not a gap to fill in. */
    missingReasonUnknown: 'Nothing on this order says why.',

    /**
     * Three endings, because there are three different truths — see
     * `features/sales-documents/lib/invoice-absence-audience.ts` for which
     * applies when, and for what the single old ending got wrong.
     */
    audience: {
      /** The order really is in the blocked count and under the filter. */
      onOfficeList: {
        title: 'The office can see this one.',
        body: 'It is in their list of orders that went out without a document — you do not need to write it down.',
      },
      /**
       * `trigger-model-manual`. Nothing is counted, nothing is filtered, so
       * nobody is told unless a person says so — which is the whole point of
       * naming it here rather than leaving the packer reassured.
       */
      issuedOnRequest: {
        title: 'Nobody is told automatically.',
        body: 'This shop only makes an invoice when someone asks for one. Send the box; if this order needs an invoice, tell the office.',
      },
      /** No recorded reason, or one this build cannot place. No list holds it. */
      nobodyTold: {
        title: 'Nobody has been told.',
        body: 'This order is not on any list OpenLinker keeps. Send the box, and mention it to the office.',
      },
    },
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
