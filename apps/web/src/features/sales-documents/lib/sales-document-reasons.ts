/**
 * Sales-Document Reasons (#2534, ADR-041 decision 11, ADR-065)
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
 * The words live in the `sales-documents` namespace (`unresolvedReasons`,
 * `gateReasons`) and are read when a property is read, so a language switch
 * reaches every caller. `short` fits a table cell (a couple of words, no full stop). `detail` is the
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
import { getMessages } from '../../../shared/i18n';

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
 * hand IS the configured workflow, and it is deliberately part of the entry so
 * a row, a popover and a panel cannot disagree about whether an action exists.
 */
export interface SalesDocumentGateReasonCopy extends SalesDocumentReasonCopy {
  tone: SalesDocumentReasonTone;
  keepsAction: boolean;
}

function unresolvedEntry(reason: SalesDocumentUnresolvedReasonValue): SalesDocumentReasonCopy {
  return {
    get short(): string {
      return getMessages('sales-documents').unresolvedReasons[reason].short;
    },
    get detail(): string {
      return getMessages('sales-documents').unresolvedReasons[reason].detail;
    },
  };
}

function gateEntry(
  reason: SalesDocumentGateBlockReasonValue,
  tone: SalesDocumentReasonTone,
  keepsAction: boolean
): SalesDocumentGateReasonCopy {
  return {
    get short(): string {
      return getMessages('sales-documents').gateReasons[reason].short;
    },
    get detail(): string {
      return getMessages('sales-documents').gateReasons[reason].detail;
    },
    tone,
    keepsAction,
  };
}

/**
 * Why routing could not decide (`SalesDocumentUnresolvedReason`).
 *
 * Every one of these reaches an order paired with the gate's
 * `'unresolved-routing'` bridge value, and it is the routing reason that carries
 * the actionable half: "routing was unresolved" is not something an operator can
 * act on, "two rules matched" is.
 *
 * `ambiguous-connection-no-primary` has two writers with two shapes, so its copy
 * names both rather than asserting whichever one it guessed.
 * `routed-connection-unavailable` names both remedies (turn the connection back
 * on, or point the rule elsewhere).
 */
export const SALES_DOCUMENT_UNRESOLVED_REASON_COPY = {
  'no-matching-rule': unresolvedEntry('no-matching-rule'),
  'conflicting-rules-equal-priority': unresolvedEntry('conflicting-rules-equal-priority'),
  'ambiguous-connection-no-primary': unresolvedEntry('ambiguous-connection-no-primary'),
  'unsupported-document-kind-on-connection': unresolvedEntry(
    'unsupported-document-kind-on-connection'
  ),
  'net-priced-order': unresolvedEntry('net-priced-order'),
  'no-configuration-for-country': unresolvedEntry('no-configuration-for-country'),
  'threshold-currency-mismatch': unresolvedEntry('threshold-currency-mismatch'),
  'no-connection-declares-document-kind': unresolvedEntry('no-connection-declares-document-kind'),
  'routed-connection-unavailable': unresolvedEntry('routed-connection-unavailable'),
} satisfies Record<SalesDocumentUnresolvedReasonValue, SalesDocumentReasonCopy>;

/**
 * Why the gate issued nothing (`SalesDocumentGateBlockReason`).
 *
 * `'unresolved-routing'` is the generic arm: when a routing reason travelled
 * alongside it, {@link resolveSalesDocumentReasonCopy} prefers that one.
 *
 * - `line-total-mismatch` (#3365): the manual issue path runs the identical
 *   lines-sum-to-total check and answers 400, so no action is kept.
 * - `missing-tax-rate` (#2248, ADR-063): issuing by hand would make a provider
 *   guess a rate, so the backend closes the manual paths too.
 * - `tax-rate-conflict` is declared but never written (#2245 F1); its copy never
 *   claims a hold.
 * - `bundle-split-unknown` (ADR-083): a set sold at one price whose components carry
 *   different tax rates cannot be split when a rate or a price is unknown; nothing
 *   is guessed on a fiscal document, so the remedy is upstream and no action is kept.
 * - `trigger-model-manual` is neutral on purpose: manual is the default trigger
 *   model, so counting it would put a large red number on a healthy install.
 * - `trigger-model-batched` (#3583): the order waits in its connection's batch
 *   queue for the next run. A configured workflow, not a fault, so neutral like
 *   manual, and the manual action stays for an order that should not wait.
 */
export const SALES_DOCUMENT_GATE_REASON_COPY = {
  'bundle-split-unknown': gateEntry('bundle-split-unknown', 'error', false),
  'unresolved-routing': gateEntry('unresolved-routing', 'error', false),
  'missing-required-tax-id': gateEntry('missing-required-tax-id', 'warning', false),
  'line-total-mismatch': gateEntry('line-total-mismatch', 'error', false),
  'missing-tax-rate': gateEntry('missing-tax-rate', 'warning', false),
  'tax-rate-conflict': gateEntry('tax-rate-conflict', 'warning', false),
  'trigger-model-manual': gateEntry('trigger-model-manual', 'neutral', true),
  'trigger-model-batched': gateEntry('trigger-model-batched', 'neutral', true),
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
