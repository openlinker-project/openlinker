/**
 * Sales-Document Block Copy (#2100, generalized across kinds #2156/#2160)
 *
 * Turns the backend's recorded auto-issue block into operator-facing copy for
 * the unified order-detail sales-document panel. Pure and `t()`-injected — no
 * React, no hooks, no I/O — so every branch is unit-testable directly instead
 * of only through a full component render.
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

/** Kind-flavored noun/verb phrases substituted into the shared copy templates. */
interface KindVocabulary {
  /** e.g. "invoicing" / "fiscal registration" / "sales-document issuance" */
  activityNoun: string;
  /** e.g. "invoice" / "receipt" / "document" */
  documentNoun: string;
  /** Plural-subject form — "Several connections can {…}". e.g. "issue invoices" */
  connectionCapabilityVerbPhrase: string;
  /** Third-person-singular form — "This connection {…} by hand." e.g. "invoices" */
  singularVerbsByHandPhrase: string;
  /** e.g. "issue" / "register" / "issue" */
  actionVerb: string;
  /** "Not {…}: …" — e.g. "invoiced" / "registered" / "issued" */
  pastParticiplePhrase: string;
}

const KIND_VOCABULARY: Record<SalesDocumentBlockCopyKind, KindVocabulary> = {
  invoice: {
    activityNoun: 'invoicing',
    documentNoun: 'invoice',
    connectionCapabilityVerbPhrase: 'issue invoices',
    singularVerbsByHandPhrase: 'invoices',
    actionVerb: 'issue',
    pastParticiplePhrase: 'invoiced',
  },
  'fiscal-receipt': {
    activityNoun: 'fiscal registration',
    documentNoun: 'receipt',
    connectionCapabilityVerbPhrase: 'register receipts',
    singularVerbsByHandPhrase: 'registers receipts',
    actionVerb: 'register',
    pastParticiplePhrase: 'registered',
  },
  mixed: {
    activityNoun: 'sales-document issuance',
    documentNoun: 'document',
    connectionCapabilityVerbPhrase: 'issue a sales document',
    singularVerbsByHandPhrase: 'issues sales documents',
    actionVerb: 'issue',
    pastParticiplePhrase: 'issued',
  },
};

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
  t: (key: string, fallback: string) => string,
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
  const v = KIND_VOCABULARY[kind];

  if (reason === null) {
    if (!derivedAmbiguity) return null;
    return {
      tone: 'warning',
      title: t(
        'salesDocument.panel.noPrimaryTitle',
        `Automatic ${v.activityNoun} is off for this order.`,
      ),
      body: t(
        'salesDocument.panel.noPrimaryBody',
        `Several connections can ${v.connectionCapabilityVerbPhrase} and none is marked primary, so OpenLinker issued nothing rather than issuing twice. Pick a connection above to ${v.actionVerb} this one by hand, or set a primary so it happens on its own.`,
      ),
      detail: null,
      offerSetPrimary: true,
    };
  }

  if (reason === 'unresolved-routing') {
    if (order.salesDocumentUnresolvedReason === 'ambiguous-connection-no-primary') {
      return {
        tone: 'error',
        title: t(
          'salesDocument.panel.blockNoPrimaryTitle',
          `Not ${v.pastParticiplePhrase}: no primary connection.`,
        ),
        body: t(
          'salesDocument.panel.blockNoPrimaryBody',
          `Several connections can ${v.connectionCapabilityVerbPhrase} and none is set to issue automatically, so OpenLinker issued nothing rather than issuing twice. Set a primary, or pick a connection above and ${v.actionVerb} this one by hand.`,
        ),
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
        title: t(
          'salesDocument.panel.blockNoCountryConfigTitle',
          `Not ${v.pastParticiplePhrase}: no rules configured for this country.`,
        ),
        body: t(
          'salesDocument.panel.blockNoCountryConfigBody',
          `Neither this order's own country nor "★ Rest of world" has any sales-document rule or default configured. Set up rules for this country (or a Rest of world default) in Settings → Sales documents, or ${v.actionVerb} this one by hand.`,
        ),
        detail,
        offerSetPrimary: false,
      };
    }
    if (order.salesDocumentUnresolvedReason === 'threshold-currency-mismatch') {
      return {
        tone: 'error',
        title: t(
          'salesDocument.panel.blockCurrencyMismatchTitle',
          `Not ${v.pastParticiplePhrase}: the order currency does not match the rule's threshold.`,
        ),
        body: t(
          'salesDocument.panel.blockCurrencyMismatchBody',
          `A matching rule compares this order's total against an amount defined in a different currency. OpenLinker never converts currencies for a fiscal decision, so nothing was ${v.pastParticiplePhrase} automatically. ${capitalize(v.actionVerb)} this one by hand, or adjust the rule's threshold.`,
        ),
        detail,
        offerSetPrimary: false,
      };
    }
    return {
      tone: 'error',
      title: t(
        'salesDocument.panel.blockUnroutedTitle',
        `Not ${v.pastParticiplePhrase}: no route for this ${v.documentNoun}.`,
      ),
      body: t(
        'salesDocument.panel.blockUnroutedBody',
        `OpenLinker could not decide where to ${v.actionVerb} this ${v.documentNoun}. Pick a connection above to ${v.actionVerb} it by hand.`,
      ),
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
      title: t(
        'salesDocument.panel.blockManualTitle',
        `This connection ${v.singularVerbsByHandPhrase} by hand.`,
      ),
      body: t(
        'salesDocument.panel.blockManualBody',
        `Nothing is wrong — no ${v.documentNoun} is issued automatically here. ${capitalize(v.actionVerb)} this one whenever you are ready.`,
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'trigger-model-batched') {
    return {
      tone: 'warning',
      title: t(
        'salesDocument.panel.blockBatchedTitle',
        `Not ${v.pastParticiplePhrase}: batched ${v.activityNoun} is not available yet.`,
      ),
      body: t(
        'salesDocument.panel.blockBatchedBody',
        `OpenLinker cannot group this order into a batch, so it issued nothing. ${capitalize(v.actionVerb)} it by hand, or switch the connection to issue on payment.`,
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'missing-required-tax-id') {
    return {
      tone: 'error',
      title: t(
        'salesDocument.panel.blockTaxIdTitle',
        `Not ${v.pastParticiplePhrase}: the buyer tax ID is missing.`,
      ),
      body: t(
        'salesDocument.panel.blockTaxIdBody',
        `This ${v.documentNoun} cannot be issued without the buyer tax ID the destination requires.`,
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  if (reason === 'missing-tax-rate') {
    return resolveMissingTaxRateCopy(rateLines, detail, t);
  }

  if (reason === 'tax-rate-conflict') {
    // Declared in the union but never written (#2245 F1): a shop-versus-channel
    // disagreement does NOT block, so this arm only guards against a newer
    // backend. Kept honest rather than deleted.
    return {
      // Tone stays `conflict` (#2253): a rate disagreement is a source
      // conflict, not a hard failure, and the panel renders the two apart.
      tone: 'conflict',
      title: t(
        'salesDocument.panel.blockTaxRateTitle',
        `Not ${v.pastParticiplePhrase}: the tax rates disagree.`,
      ),
      body: t(
        'salesDocument.panel.blockTaxRateBody',
        `The channel's tax rate does not match the master catalogue, so OpenLinker did not issue a ${v.documentNoun} it could not vouch for.`,
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  // A reason this build does not recognise (a newer backend). Say the honest
  // minimum rather than nothing — the operator still needs to know why the order
  // has no document.
  return {
    tone: 'warning',
    title: t('salesDocument.panel.blockUnknownTitle', `Not ${v.pastParticiplePhrase}.`),
    body: t(
      'salesDocument.panel.blockUnknownBody',
      `OpenLinker declined to issue a ${v.documentNoun} for this order. ${capitalize(v.actionVerb)} it by hand if it should be.`,
    ),
    detail,
    offerSetPrimary: false,
  };
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`;
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
  t: (key: string, fallback: string) => string,
): SalesDocumentBlockCopy {
  const names = lines.map((line) => line.name).filter(Boolean);
  const count = Math.max(names.length, 1);
  const list = names.length > 0 ? names.join(', ') : t('invoice.panel.someLines', 'Some lines');

  const uncatalogued = lines.filter((line) => !line.inCatalogue);
  if (uncatalogued.length > 0 && uncatalogued.length === lines.length) {
    const subject = uncatalogued.map((line) => line.name).join(', ');
    return {
      tone: 'error',
      title:
        uncatalogued.length === 1
          ? `${t('invoice.panel.blockNoRateUncataloguedTitle', 'Not invoiced:')} ${subject} ${t('invoice.panel.blockNoRateUncataloguedTitleTail', 'is not in your catalogue.')}`
          : `${t('invoice.panel.blockNoRateUncataloguedTitlePlural', 'Not invoiced:')} ${String(uncatalogued.length)} ${t('invoice.panel.blockNoRateUncataloguedTitlePluralTail', 'items are not in your catalogue.')}`,
      body: t(
        'invoice.panel.blockNoRateUncataloguedBody',
        'The channel reported no rate at purchase, and fixing the offer now will not release this order. Add the item to a shop to release it.',
      ),
      detail,
      offerSetPrimary: false,
    };
  }

  return {
    tone: 'error',
    title: `${t('invoice.panel.blockNoRateTitle', 'Not invoiced:')} ${String(count)} ${
      count === 1
        ? t('invoice.panel.blockNoRateTitleTail', 'line has no tax rate.')
        : t('invoice.panel.blockNoRateTitleTailPlural', 'lines have no tax rate.')
    }`,
    body: `${list} ${t(
      'invoice.panel.blockNoRateBody',
      'have no rate in the shop, and the channel did not report one. Rates arrive with the product sync.',
    )}`,
    detail,
    offerSetPrimary: false,
  };
}
