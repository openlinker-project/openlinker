/**
 * Sales-Document Reason Copy (#2534, ADR-041 decision 11, ADR-065)
 *
 * ONE entry per reason id, for BOTH persisted vocabularies, consumed by every
 * surface that has to explain why an order carries no fiscal document: the
 * `/orders` row, the order-detail panel, and the settings page.
 *
 * Two rules give this module its shape, and both come from ADR-065:
 *
 *  1. **A surface never re-derives a fact the backend persists.** The copy is
 *     keyed on the persisted reason and nothing else - never on the order's
 *     country, its connections, or any other client-side inference. A draft of
 *     the list did exactly that and printed `no rule for PL` while the real
 *     reason was something else entirely, which is a false statement about the
 *     operator's own configuration.
 *  2. **A reason with no copy must not be able to ship.**
 *     `scripts/check-sales-document-reason-mirror.mjs` compares the keys of both
 *     maps below against the backend unions, so a reason added in
 *     `libs/core/src/sales-documents` fails `pnpm lint` until copy exists here.
 *     The `satisfies Record<…>` annotations catch the same thing at compile
 *     time; the script catches it for a value added to core alone, which the
 *     type system cannot see.
 *
 * `short` fits a table cell (a couple of words, no full stop). `detail` is the
 * long form for a popover or a panel, and always ends with what changes the
 * situation where anything can.
 *
 * Copy rule, carried over from the shipped invoicing surfaces: state the fact,
 * then the one action that changes it. No apology, and the reason literal never
 * reaches the screen.
 *
 * @module apps/web/src/features/sales-documents/lib
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
import type {
  SalesDocumentGateBlockReasonValue,
  SalesDocumentUnresolvedReasonValue,
} from '../../orders';

/** Tone a reason is rendered in. A subset of `AlertTone` / `StatusBadgeTone`. */
export type SalesDocumentReasonTone = 'neutral' | 'info' | 'warning' | 'error';

/** Copy for one routing reason - why routing could not name a document. */
export interface SalesDocumentReasonCopy {
  /** Table-cell label: a couple of words, no trailing full stop. */
  short: string;
  /** Long form for a popover or a panel. Full sentences. */
  detail: string;
}

/**
 * Copy for one gate reason, plus the two facts every surface needs about it.
 *
 * `keepsAction` is the one behavioural field: it says whether the surface should
 * still offer to issue the document by hand. It is true only where issuing by
 * hand IS the configured workflow, and it is deliberately part of the copy entry
 * so a row, a popover and a panel cannot disagree about whether an action exists.
 */
export interface SalesDocumentGateReasonCopy extends SalesDocumentReasonCopy {
  tone: SalesDocumentReasonTone;
  keepsAction: boolean;
}

/**
 * Why routing could not decide (`SalesDocumentUnresolvedReason`).
 *
 * Every one of these reaches an order paired with the gate's
 * `'unresolved-routing'` bridge value, and it is the routing reason that carries
 * the actionable half: "routing was unresolved" is not something an operator can
 * act on, "two rules matched" is.
 */
export const SALES_DOCUMENT_UNRESOLVED_REASON_COPY = {
  'no-matching-rule': {
    short: 'No rule matched',
    detail:
      'No rule here matched this order, and there is no single default to fall back on. The order is held. It does not pass to Rest of world.',
  },
  'conflicting-rules-equal-priority': {
    short: 'Two rules matched',
    detail:
      'Two or more rules matched this order. Rules have no order of priority, so nothing picks a winner and the order is held. Narrow the conditions until only one rule can match.',
  },
  /**
   * Two writers, two different shapes, one reason id - so the copy names both
   * rather than asserting whichever one it guessed. `evaluateSalesDocumentRules`
   * emits it when a country carries an invoice default AND a receipt default;
   * `resolveSalesDocumentRouting` emits it when several providers can issue and
   * none carries `isPrimary`. Naming only one would be a false statement about
   * the operator's configuration in every order the other writer produced.
   */
  'ambiguous-connection-no-primary': {
    short: 'Two setups apply',
    detail:
      'More than one setup could issue this document and nothing chooses between them: either this country has both an invoice default and a receipt default, or several providers can issue and none is marked to go first. Keep one of them, or add a rule that decides.',
  },
  'unsupported-document-kind-on-connection': {
    short: 'Provider cannot issue this',
    detail:
      'Routing picked a document this provider cannot issue. Choose a provider that issues this kind.',
  },
  'net-priced-order': {
    short: 'Order is net-priced',
    detail:
      'A rule compares the order total, but this order is priced net. The comparison cannot be made, so the order is held.',
  },
  'no-configuration-for-country': {
    short: 'No routing anywhere',
    detail:
      'Neither this country nor Rest of world has a rule or a default. Nothing is issued here, and nothing will be until you set routing.',
  },
  'threshold-currency-mismatch': {
    short: 'Currency does not match',
    detail:
      'A rule sets its limit in a different currency from this order. Amounts are never converted when routing decides, so the order is held.',
  },
} satisfies Record<SalesDocumentUnresolvedReasonValue, SalesDocumentReasonCopy>;

/**
 * Why the gate issued nothing (`SalesDocumentGateBlockReason`).
 *
 * `'unresolved-routing'` is the generic arm: when a routing reason travelled
 * alongside it, {@link resolveSalesDocumentReasonCopy} prefers that one.
 */
export const SALES_DOCUMENT_GATE_REASON_COPY = {
  'unresolved-routing': {
    short: 'No routing',
    detail:
      'Routing could not decide which document this order gets. Check the rules for its country.',
    tone: 'error',
    keepsAction: false,
  },
  'missing-required-tax-id': {
    short: 'No buyer tax ID',
    detail: 'This document needs the buyer tax ID, and the order does not have one.',
    tone: 'warning',
    keepsAction: false,
  },
  /**
   * The one reason where the absent action is a server-side refusal rather than
   * a presentation choice (#2248, ADR-063): issuing by hand would make a
   * provider guess a rate onto a real fiscal document, so the backend closes the
   * manual paths too.
   *
   * Subject-neutral on purpose (#2260 review): the gate blocks both on a
   * rate-less product line and on a delivery charge that cannot be attributed to
   * any rate. A surface holding the order's lines can name the subject; this
   * copy must not, because a row does not hold them.
   */
  'missing-tax-rate': {
    short: 'Tax rate missing',
    detail:
      'Something on this order has no tax rate. Nothing is guessed here, so the document is held. Set the rate in your shop catalogue.',
    tone: 'warning',
    keepsAction: false,
  },
  /**
   * Declared in the union but never written (#2245 F1): a shop-versus-channel
   * disagreement does NOT hold the document - the shop rate wins, the document
   * issues, and the mismatch surfaces on its own field with its own resolver.
   * The copy therefore states the disagreement and never claims a hold, so a
   * newer backend that starts writing it cannot make a surface say something
   * false.
   */
  'tax-rate-conflict': {
    short: 'Tax rate conflict',
    detail:
      'Your shop and the sales channel give different tax rates for a line. The shop rate is the one used.',
    tone: 'warning',
    keepsAction: false,
  },
  /**
   * Neutral on purpose, and the one reason an attention count must exclude:
   * manual is the default trigger model, so on a manual install every
   * uninvoiced order carries it and counting them puts a large red number on a
   * healthy install (ADR-041 §54). The count itself is the backend's
   * (`SalesDocumentAttentionReasonValues`), so no second partition is kept here.
   */
  'trigger-model-manual': {
    short: 'Issued on request',
    detail: 'This provider only issues when you ask it to, so nothing was issued automatically.',
    tone: 'neutral',
    keepsAction: true,
  },
  /**
   * Batched issuing is NOT implemented - `AutoIssueTriggerService` raises
   * `BatchedTriggerNotImplementedError` and records this reason - so the copy
   * must never promise a run that will collect the order. It keeps the manual
   * action because that is the only way this order gets a document at all.
   */
  'trigger-model-batched': {
    short: 'Batched',
    detail:
      'This connection is set to issue in batches, and batched issuing is not available yet, so nothing was issued. Issue it by hand, or switch the connection to issue on payment.',
    tone: 'warning',
    keepsAction: true,
  },
} satisfies Record<SalesDocumentGateBlockReasonValue, SalesDocumentGateReasonCopy>;

/**
 * Resolve the copy for one persisted block.
 *
 * Reads ONLY the two persisted values. Returns `null` for an unblocked order and
 * for a reason this build does not recognise - a newer backend renders nothing
 * rather than an unlabelled badge, and the mirror script is what stops that from
 * happening silently.
 *
 * When the gate recorded the `'unresolved-routing'` bridge value and a routing
 * reason travelled with it (ADR-041 §107), the routing reason supplies the words
 * while the gate entry supplies the tone and the action. That pairing is the
 * whole reason the two unions are kept apart.
 */
export function resolveSalesDocumentReasonCopy(
  reason: SalesDocumentGateBlockReasonValue | null | undefined,
  unresolvedReason?: SalesDocumentUnresolvedReasonValue | null
): SalesDocumentGateReasonCopy | null {
  if (!reason) return null;

  // Both lookups are cast wider than the index signature: the value arrives from
  // an API payload, so a newer backend can hand this build a reason outside the
  // union it was compiled against, and the type would otherwise promise an entry
  // that is not there.
  const gate = SALES_DOCUMENT_GATE_REASON_COPY[reason] as SalesDocumentGateReasonCopy | undefined;
  if (!gate) return null;

  if (reason === 'unresolved-routing' && unresolvedReason) {
    const routing = SALES_DOCUMENT_UNRESOLVED_REASON_COPY[unresolvedReason] as
      | SalesDocumentReasonCopy
      | undefined;
    if (routing) {
      // The routing reason supplies the words; the gate supplies the tone and
      // whether an action remains.
      return { ...gate, short: routing.short, detail: routing.detail };
    }
  }

  return gate;
}
