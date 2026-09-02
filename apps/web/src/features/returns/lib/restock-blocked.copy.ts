/**
 * Restock-blocked copy (#2381, returns spec § 5.4)
 *
 * **The single home for every string describing a refused restock.** The returns
 * spec is the canonical copy owner (§ 5.4: *"Where any other document disagrees
 * with the strings below, this section wins"*); this module is that section
 * rendered.
 *
 * ## Why a shared module, and why now
 *
 * § 5.4 requires the SAME title text on three surfaces — the list row badge, the
 * per-line notice, and the order-detail returns panel. Byte-identity between
 * them has to be structural rather than aspirational: a second copy of the
 * sentence cannot exist without someone deleting an import.
 *
 * It is created here **on #2357's behalf** (`W2-20`, the RB-L attention state),
 * sized to exactly the two surfaces #2381 ships and no further — no speculative
 * entries for states this issue does not render. **#2357 adopts and extends this
 * module rather than starting a rival**, and so does the split-out order-detail
 * panel issue. That inverts the dependency in the cheap direction: widening an
 * existing module later is routine, whereas consolidating three drifted local
 * copies is a refactor nobody schedules.
 *
 * ## Reachability
 *
 * Exported from `features/returns/index.ts`, and that export is **load-bearing,
 * not decorative**: `.eslintrc.js` registers the `returns` slug in both
 * `no-restricted-imports` pattern groups for every canonical subdirectory, so a
 * cross-feature consumer is hard-blocked from deep-importing `lib/…` and can
 * only reach this through the barrel — the shape #2100's
 * `sales-document-block-copy.ts` established (`features/orders` imports it as
 * `from '../../invoicing'`).
 *
 * ## The rule that keeps it honest
 *
 * **This module is the only place these sentences exist.** A variant
 * interpolated at a call site belongs IN here. Every consumer that CAN import
 * this must — a mirror script exists for halves that cannot.
 *
 * **Amended (#2673): `title` now has exactly such a half.**
 * `ATTENTION_REASON_COPY['restock-blocked'].title` in
 * `features/fulfillment-authority` restates this sentence rather than importing
 * it, because that module is imported BY the returns badge surfaces and a
 * barrel-to-barrel edge back would close a cycle (#337/#359). That is the
 * boundary the original note said did not exist, and
 * `scripts/check-attention-reason-mirror.mjs` MIRROR 6 holds the two
 * byte-identical. **So `RETURN_RESTOCK_BLOCKED_COPY.title` is load-bearing
 * across a feature boundary**: renaming the constant, moving this file, or
 * editing the sentence fails `pnpm check:invariants` naming the pair. Nothing
 * else here is mirrored; a new field is a local concern until some other
 * feature is forced to restate it.
 *
 * @module apps/web/src/features/returns/lib
 */

/**
 * The refusal itself — used by the list badge and the per-line notice.
 *
 * `title` is the string § 5.4 requires to be identical across every surface.
 */
export const RETURN_RESTOCK_BLOCKED_COPY = {
  /** The list-row badge, and the segment that counts it. */
  badge: 'Restock blocked',

  title: 'Stock was not added.',
  bodyPrefix: 'OpenLinker recorded the disposition, but',
  /**
   * Used when the refusing connection cannot be named. Never a blank: "…but
   * did not accept the change" reads as a truncated sentence, and an operator
   * cannot act on it.
   */
  bodyUnknownConnection: 'the system that owns your stock',
  bodySuffix: 'does not accept stock adjustments from OpenLinker, so your stock has not changed.',

  remedyPrefix: 'Add',
  remedyJoin: '×',
  remedyMiddle: 'in',
  remedySuffix: 'yourself, then mark this handled.',
  /** When the line names no sku there is nothing to tell them to add BY name. */
  remedyUnknownSku: 'the returned units',

  attest: 'Mark stock handled manually',
  openConnection: 'Open',
  why: 'Why did this happen?',
  whyCollapse: 'Hide',
} as const;

/**
 * The `Why did this happen?` disclosure (§ 5.4, verbatim).
 *
 * Expands INLINE — not a modal, not a link out. It carries no blame, no jargon
 * and deliberately no promise of a fix date: the real remedy is implementing
 * `adjustInventory` on that master, which is a scheduling decision and not
 * something to hint at in a disclosure.
 */
export const RETURN_RESTOCK_BLOCKED_EXPLAINER = {
  heading: "OpenLinker can publish your stock, but it can't always change it.",
  bodyPrefix: 'Adding stock back needs a write into the system that owns your stock.',
  bodyMiddle:
    'accepts stock readings from OpenLinker but not stock adjustments, so OpenLinker recorded what you decided and stopped there rather than telling you it had done something it hadn’t.',
  bodySuffix:
    'Nothing is lost: the units are still counted as received on this return, and this message stays until you say you’ve handled it.',
} as const;

/**
 * The state AFTER an operator attests — the terminal state of the remediation
 * loop, and the reason the attestation is worth clicking.
 *
 * Neutral tone: not success (OpenLinker did not succeed at anything) and not
 * error (nothing is outstanding). No actions.
 *
 * **`{user}` is not a name and must not be rendered as one.** Nothing in the
 * tree resolves a user id to a display name — there is no `IUsersService` — so
 * this says *"by you"* when the actor matches the session user and *"by another
 * operator"* when it does not. A raw id is not an answer to *who* and reads as a
 * defect; a name OpenLinker cannot verify is worse.
 */
export const RETURN_RESTOCK_ATTESTED_COPY = {
  prefix: 'Stock added manually',
  byYou: 'by you',
  byOther: 'by another operator',
  on: 'on',
  /** The load-bearing half. It is never dropped, whatever the attribution. */
  disclaimer: 'OpenLinker did not change your stock.',
  /** Transient confirmation. The persistent record is the row above. */
  toast: 'Recorded that you handled the stock yourself.',
} as const;
