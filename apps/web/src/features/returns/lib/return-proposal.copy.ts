/**
 * Credit-note proposal copy (#2382, returns spec § 5.8)
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_PROPOSAL_COPY = {
  sectionTitle: 'Credit note proposal',
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
  handoff: 'Review and issue on the invoice',
  reviewCta: 'Confirm these matches',

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
  } as Record<string, string>,

  outcomes: {
    'nothing-correctable': 'Nothing on this return can be credited yet.',
    'no-invoice': 'No invoice has been issued for this order, so there is nothing to correct.',
    'no-line-snapshot':
      'The invoice was issued before OpenLinker recorded its lines, so they cannot be matched automatically.',
    'no-disposed-lines': 'No returned units have been disposed of yet.',
  } as Record<string, string>,
} as const;
