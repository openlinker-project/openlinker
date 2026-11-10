/**
 * Sales-Document Block (#2100, generalized across kinds #2156/#2160)
 *
 * Turns the backend's recorded auto-issue block into operator-facing copy for
 * the unified order-detail sales-document panel. Pure - no React, no hooks, no
 * I/O - so every branch is unit-testable directly instead of only through a
 * full component render. Each kind has its own whole sentences in the
 * `invoicing` namespace, read at call time.
 *
 * KIND-AWARE, not kind-SPECIFIC (#2156/#2160): since `AutoIssueTriggerService`
 * resolves across BOTH `'invoice'` and `'fiscal-receipt'` candidates through
 * one shared resolver, the persisted reason columns are document-kind-agnostic
 * — they say WHY nothing was issued, never WHICH kind almost was. The caller
 * therefore supplies `kind` from what it can determine locally: `'invoice'` /
 * `'fiscal-receipt'` when the order's candidate connections are all one kind
 * (the overwhelmingly common case today, since fiscalization v1 has no
 * auto-issue/primary concept of its own — ADR-042 decision 9), or `'mixed'`
 * when both kinds are genuinely in the running and the copy must not claim a
 * kind the data does not support.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';
import type { OrderRecord } from '../../orders';

/** Which sales-document kind(s) the caller's local candidate pool covers. */
export type SalesDocumentBlockCopyKind = 'invoice' | 'fiscal-receipt' | 'mixed';

/** One rendered explanation of why this order carries no fiscal document (#2100). */
export interface SalesDocumentBlockCopy {
  /**
   * Passed straight into `<Alert>`, so it must stay a subset of `AlertTone`.
   * `'conflict'` (#2253) is available for a non-blocking source disagreement.
   */
  tone: 'conflict' | 'warning' | 'error' | 'info';
  title: string;
  body: string;
  /** PII-free elaboration the backend supplied, if any. */
  detail: string | null;
  /** Whether to offer the one-click "Set a primary" remediation. */
  offerSetPrimary: boolean;
}

/** Which copy subtree each kind reads: one set of whole sentences per kind. */
const KIND_COPY_KEY = {
  invoice: 'invoice',
  'fiscal-receipt': 'fiscalReceipt',
  mixed: 'mixed',
} as const satisfies Record<SalesDocumentBlockCopyKind, string>;

type KindCopy = ReturnType<
  typeof getMessages<'invoicing'>
>['salesDocument']['panel'][(typeof KIND_COPY_KEY)[SalesDocumentBlockCopyKind]];

/**
 * Turn the backend's recorded block into operator-facing copy (#2100, ADR-041
 * decision 11).
 *
 * Reads `order.salesDocumentBlockReason` — the gate's own decision — rather than
 * re-deriving anything. Keys on the paired ROUTING reason for a
 * `'unresolved-routing'` block (ADR-041 §107), because "routing was unresolved"
 * is not actionable while "no primary connection" is.
 *
 * `derivedAmbiguity` is a FALLBACK ONLY, for an order the gate has not
 * re-evaluated since this shipped (the columns are nullable with no backfill —
 * inventing a historical reason would badge orders wrongly), and is only ever
 * derivable for `kind: 'invoice'` today — fiscalization v1 has no client-side
 * ambiguity signal to derive (ADR-042 decision 9), so callers pass `false` for
 * `'fiscal-receipt'` / `'mixed'`. The persisted value always wins when present.
 *
 * Copy rule, carried over from `InvoiceConnectionLock`: state the fact, then the
 * one action that changes it. No apology, and the reason literal never reaches the
 * screen.
 */
export function resolveSalesDocumentBlockCopy(
  order: OrderRecord,
  derivedAmbiguity: boolean,
  kind: SalesDocumentBlockCopyKind = 'invoice',
  /**
   * The rate-less lines, when the reason is `missing-tax-rate` (#2254).
   *
   * Passed in rather than re-derived, because the remedy depends on WHY a rate
   * is absent and only the lines say which case this is. Omitted elsewhere.
   */
  rateLines: RateLessLine[] = [],
): SalesDocumentBlockCopy | null {
  const reason = order.salesDocumentBlockReason ?? null;
  const detail = order.salesDocumentBlockDetail ?? null;
  const c = getMessages('invoicing').salesDocument.panel[KIND_COPY_KEY[kind]];

  if (reason === null) {
    if (!derivedAmbiguity) return null;
    return {
      tone: 'warning',
      title: c.noPrimaryTitle,
      body: c.noPrimaryBody,
      detail: null,
      offerSetPrimary: true,
    };
  }

  if (reason === 'unresolved-routing') {
    if (order.salesDocumentUnresolvedReason === 'ambiguous-connection-no-primary') {
      return {
        tone: 'error',
        title: c.blockNoPrimaryTitle,
        body: c.blockNoPrimaryBody,
        detail,
        offerSetPrimary: true,
      };
    }
    // #2170 — the country-agnostic rule engine's own two additions. #2173
    // wired `evaluateSalesDocumentRules` into `AutoIssueTriggerService` as
    // the first-consulted resolver, so both reasons ARE reachable from a
    // real order today.
    if (order.salesDocumentUnresolvedReason === 'no-configuration-for-country') {
      return {
        tone: 'error',
        title: c.blockNoCountryConfigTitle,
        body: c.blockNoCountryConfigBody,
        detail,
        offerSetPrimary: false,
      };
    }
    // A rule's connection is checked only when the rule is saved, so it can
    // still name a connection that has since been turned off, removed, or lost
    // the capability. Generic "no route" copy would send the operator looking
    // at the rules for a gap that is not there.
    if (order.salesDocumentUnresolvedReason === 'routed-connection-unavailable') {
      return {
        tone: 'error',
        title: c.blockRoutedConnectionUnavailableTitle,
        body: c.blockRoutedConnectionUnavailableBody,
        detail,
        offerSetPrimary: false,
      };
    }
    if (order.salesDocumentUnresolvedReason === 'threshold-currency-mismatch') {
      return {
        tone: 'error',
        title: c.blockCurrencyMismatchTitle,
        body: c.blockCurrencyMismatchBody,
        detail,
        offerSetPrimary: false,
      };
    }
    return {
      tone: 'error',
      title: c.blockUnroutedTitle,
      body: c.blockUnroutedBody,
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'trigger-model-manual') {
    return {
      // Quiet on purpose: a manual connection is a deliberate operator choice, not
      // a misconfiguration. The fact is still stated so the panel never looks like
      // it simply forgot.
      tone: 'info',
      title: c.blockManualTitle,
      body: c.blockManualBody,
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'trigger-model-batched') {
    // #3583: queued for the connection's next batch run - a workflow, not a
    // fault, so quiet like manual.
    return {
      tone: 'info',
      title: c.blockBatchedTitle,
      body: c.blockBatchedBody,
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'missing-required-tax-id') {
    return {
      tone: 'error',
      title: c.blockTaxIdTitle,
      body: c.blockTaxIdBody,
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'missing-tax-rate') {
    return resolveMissingTaxRateCopy(rateLines, detail, c);
  }

  if (reason === 'tax-rate-conflict') {
    // Declared in the union but never written (#2245 F1): a shop-versus-channel
    // disagreement does NOT block, so this arm only guards against a newer
    // backend. Kept honest rather than deleted.
    return {
      // Tone stays `conflict` (#2253): a rate disagreement is a source
      // conflict, not a hard failure, and the panel renders the two apart.
      tone: 'conflict',
      title: c.blockTaxRateTitle,
      body: c.blockTaxRateBody,
      detail,
      offerSetPrimary: false,
    };
  }

  // A reason this build does not recognise (a newer backend). Say the honest
  // minimum rather than nothing — the operator still needs to know why the order
  // has no document.
  return {
    tone: 'warning',
    title: c.blockUnknownTitle,
    body: c.blockUnknownBody,
    detail,
    offerSetPrimary: false,
  };
}

/**
 * One line with no tax rate, as the panel knows it (#2254).
 *
 * `inCatalogue` is what separates the two hardest remedies: a product OL has
 * mapped can be fixed in its shop, while an item that exists only as a
 * marketplace offer cannot be released by fixing that offer at all - the
 * marketplace stamped the rate at purchase.
 */
export interface RateLessLine {
  name: string;
  inCatalogue: boolean;
}

/**
 * Which subject a `missing-tax-rate` block is about (#2260 review).
 *
 * The backend gate (`findOrderTaxRateGap`) refuses in two shapes: a product line
 * with no rate, and - with every product line rated - a delivery charge that
 * cannot be attributed to any rate (an empty basket, or every line grossing
 * zero). The persisted reason is the same in both, so the panel reads the scope
 * off the same fact the gate did: no rate-less line means the delivery charge is
 * the only thing left with nowhere to sit.
 *
 * It exists so the copy AND the disabled control agree on one answer, instead of
 * each deriving its own.
 */
export function resolveMissingTaxRateScope(
  rateLines: readonly RateLessLine[],
): 'lines' | 'shipping' {
  return rateLines.length === 0 ? 'shipping' : 'lines';
}

/**
 * The two remedy branches for a missing rate (#2254).
 *
 * One sentence would be wrong here, because the REASON a rate is absent decides
 * the remedy and the two are not interchangeable:
 *
 *  1. blank on a mapped product - set it in the shop, and the fix releases this
 *     order on the next sync;
 *  2. the item is in no catalogue - fixing the offer will NOT release this
 *     order, because the marketplace stamped the rate at purchase; the only
 *     route is adding the item to a shop.
 *
 * A third case exists in the domain - the shop's tax class matches several
 * rates, so the rate TABLE is what needs fixing rather than the product - and it
 * is deliberately NOT branched on here. The reason (`TaxRateUnknownReason`,
 * `libs/core/src/products/domain/types/tax-rate.types.ts`) is dropped when the
 * master's answer is projected onto the catalogue, so it never reaches the order
 * snapshot the panel reads. A branch keyed on a flag that is always false is
 * copy the operator can never see, and it pointed at the product when the fix is
 * in the shop's rate table - worse than saying less.
 *
 * Plural-safe with a count, deliberately: a forty-line B2B order with six
 * rate-less lines cannot be told about one product, and every other branch in
 * this file is order-scoped and singular by nature.
 */
function resolveMissingTaxRateCopy(
  lines: RateLessLine[],
  detail: string | null,
  c: KindCopy,
): SalesDocumentBlockCopy {
  // Shipping scope (#2260 review): the gate blocked on a missing rate while
  // every product line HAS one, so the subject is the delivery charge, not a
  // line. Saying "1 line has no tax rate" here would be flatly false, and
  // naming a count no line supports would be an invention.
  if (resolveMissingTaxRateScope(lines) === 'shipping') {
    return {
      tone: 'error',
      title: c.blockNoRateShippingTitle,
      body: c.blockNoRateShippingBody,
      detail,
      offerSetPrimary: false,
    };
  }

  const copy = getMessages('invoicing').invoice.panel;
  const locale = getLocale();
  const names = lines.map((line) => line.name).filter(Boolean);
  // Count the LINES, never a floor: past the shipping branch there is at least
  // one rate-less line, so the number is always a real one. `names` can still be
  // short of `lines` if a line carried no printable name at all, which is the
  // only case the unnamed-subject wording is reached for - and it is true there.
  const count = lines.length;
  const list = names.length > 0 ? names.join(', ') : copy.someLines;

  const uncatalogued = lines.filter((line) => !line.inCatalogue);
  if (uncatalogued.length > 0 && uncatalogued.length === lines.length) {
    const subject = uncatalogued.map((line) => line.name).join(', ');
    return {
      tone: 'error',
      title:
        uncatalogued.length === 1
          ? interpolate(copy.blockNoRateUncataloguedTitle, { subject })
          : formatPlural(uncatalogued.length, copy.blockNoRateUncataloguedTitlePlural, locale),
      body: copy.blockNoRateUncataloguedBody,
      detail,
      offerSetPrimary: false,
    };
  }

  return {
    tone: 'error',
    title: formatPlural(count, copy.blockNoRateTitle, locale),
    body: interpolate(copy.blockNoRateBody, { list }),
    detail,
    offerSetPrimary: false,
  };
}
