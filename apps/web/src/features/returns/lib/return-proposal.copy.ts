/**
 * Credit-note proposal copy (#2382, returns spec § 5.8)
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_PROPOSAL_COPY = {
  sectionTitle: 'Credit note proposal',

  /** The headline metric — the acceptance criterion is that it needs no scroll. */
  headlineLabel: 'Total credit',
  /**
   * A correction credits quantity only — core computes no net for it and
   * rounds nothing (ADR-063); the provider computes and rounds the actual
   * issued amounts. This figure is OpenLinker's own estimate from the
   * invoice's own line prices, and the operator must not read it as the
   * number the document will carry.
   */
  headlineEstimateNote: "Estimated from the invoice's own line prices — the issued document's amounts come from your invoicing provider.",
  breakdownAutomatic: 'Credited automatically',
  breakdownNeedsPick: 'Needs your pick',
  breakdownCantCredit: "Can't credit yet",
  /**
   * Leads the panel, and is the reason the panel exists rather than an
   * auto-issue: a transmitted correction is a fiscal document that cannot be
   * withdrawn once it has gone.
   *
   * NOTE the wording: `check-ui-vocabulary` (design rule P9) bans the word
   * `authority` from operator-facing copy, so this cannot say "sent to the tax
   * authority" however natural that reads. "Issued and sent" carries the same
   * fact without the banned term — and is arguably plainer for an operator who
   * does not think in terms of who receives it.
   */
  irreversible:
    'Once a credit note has been issued and sent, it cannot be withdrawn. Check every line before you confirm.',
  /** § 5.8's rule, stated in the footer so nobody has to infer it. */
  noAutoIssue:
    'OpenLinker never issues a credit note on its own. It matches the returned lines to the invoice and shows you what it found; issuing is always your decision.',
  /**
   * Opens the provider's own `InvoiceCorrectionFlow` in a dialog on THIS
   * page (#3094 amendment) — never navigation. Deliberately not "…on the
   * invoice": that phrase read as a `/invoices/:id` link (what it replaced)
   * and is misleading now that the flow opens here, with the operator's
   * unsaved page state still around them (PR #3379 review).
   */
  handoff: 'Review and issue correction',
  handoffDialogTitle: 'Issue correction',
  reviewCta: 'Confirm these matches',
  /** While the invoice + connection reads this needs are still in flight. */
  handoffLoading: 'Loading correction options…',
  /**
   * The issuing connection is inactive or no longer has `Invoicing`
   * enabled — the same "stale" signal `sales-document-panel.tsx` surfaces
   * on the order page, repeated here so an operator does not click a
   * button that cannot do anything.
   */
  handoffConnectionStale:
    'The connection that issued this invoice is disabled or no longer set up for invoicing — a correction cannot be issued from here right now.',
  /**
   * No `InvoiceCorrectionFlow` is registered for this invoice's platform, or
   * the invoice/connection could not be resolved at all. Never a fabricated
   * link — the mockup's own gap legend calls a dead link "drift, not a
   * design choice". A real, resolved invoice still gets a real route to its
   * own page (`viewInvoice` below) — that page still exists and still has
   * the provider region; the dialog removed a shortcut, not the destination
   * (PR #3379 review).
   */
  handoffUnavailable:
    'No correction flow is available for this invoice from here yet.',
  /** The fallback route when the on-page dialog cannot help — the invoice's own page. */
  viewInvoice: 'View the invoice',

  /**
   * The action this panel actually performs — recording an ADR-044 change
   * proposal, never issuing a document. Deliberately not "Issue credit note"
   * (the mockup's confirm-dialog CTA), which would contradict `noAutoIssue`
   * printed in the same panel.
   */
  recordAction: 'Record for review',
  recordPending: 'Recording…',
  recordedBadge: 'Recorded for review',
  recordSuccess: 'Recorded for review.',
  recordError: 'Could not record the proposal. Try again.',
  recordBlockedAmbiguous:
    'At least one line needs a pick before this can be recorded.',
  readOnly: 'Your account can see this credit note but cannot record it.',

  statusMatched: 'Matched',
  statusAmbiguous: 'Needs your choice',
  statusNoMatch: 'Not included',

  /**
   * The banner that must make an ambiguous proposal visibly different from a
   * clean one BEFORE any confirm — the issue's own acceptance criterion.
   */
  ambiguousBanner:
    'OpenLinker could not tell which invoice line some of these returned items came from. Pick one for each before confirming — it decides which line the credit note corrects.',
  cleanBanner: 'Every returned line matched exactly one invoice line.',

  /**
   * Rendered where candidates differ only by price or tax rate. Evidence, never
   * a tie-break: OpenLinker showing a difference is not OpenLinker choosing.
   */
  candidatesDiffer:
    'These candidates differ in price or tax rate, so the choice changes the amount credited.',

  noMatchReasons: {
    'no-line-name': 'The returned line has no name to match on.',
    'no-line-by-name': 'No invoice line has this name.',
    'quantity-exceeds-invoiced': 'More units were returned than the invoice billed.',
    'disposition-not-confirmed':
      'These units are not confirmed disposed of yet — a refused restock is still outstanding.',
    // Defensive fallback only — the server-supplied `noMatchExplanation` (#3312)
    // is always populated for this reason today; this entry keeps the local
    // fallback text in sync should that ever not be the case.
    'ambiguous-invoice-line':
      'This return could not be matched to exactly one invoice line automatically. Check the invoice by hand before crediting it.',
  } as Record<string, string>,

  outcomes: {
    'nothing-correctable': 'Nothing on this return can be credited yet.',
    'no-invoice': 'No invoice has been issued for this order, so there is nothing to correct.',
    'no-line-snapshot':
      'The invoice was issued before OpenLinker recorded its lines, so they cannot be matched automatically.',
    'no-disposed-lines': 'No returned units have been disposed of yet.',
  } as Record<string, string>,

  /**
   * A short badge per non-proposing outcome — the mockup's per-state
   * `badge` text, minus `credit-issued` (no issuing surface exists here)
   * and `credit-absent-orphan` (the page never requests a proposal for an
   * orphan at all, so no outcome-specific copy is needed for it).
   */
  outcomeBadges: {
    'nothing-correctable': 'Nothing to credit',
    'no-invoice': 'No invoice',
    'no-line-snapshot': 'Lines not stored',
    'no-disposed-lines': 'Nothing to credit yet',
  } as Record<string, string>,

  /**
   * Where a non-proposing outcome names a real, reachable remedy on THIS
   * page. Only `no-disposed-lines` gets one: the custody section exists at
   * `#custody` and is the actual next step. `no-invoice` and
   * `no-line-snapshot` have no in-app destination — the mockup's own hrefs
   * for those are placeholders (`#`), and a fabricated link would be worse
   * than none.
   */
  recordWhatCameBack: 'Record what came back',

  /**
   * `credit-absent-orphan` (#3094). The page never REQUESTS a proposal for an
   * orphan — the route answers 409 — so this is never a fetched outcome, only
   * a fixed message keeping the section's place at #correction rather than
   * leaving it silently absent.
   */
  orphanAbsent: 'No credit note is prepared for an unmatched return. Match it to an order first.',
} as const;
