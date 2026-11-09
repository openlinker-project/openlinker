/**
 * Describe a dry-run result back to the operator (#3191)
 *
 * "Test with a sample order" answers one question - what would THIS order
 * get, right now, if the rule being drafted were saved - and this pure
 * function turns the backend's `SalesDocumentDryRunResult` into the one
 * sentence a caller renders. Reuses `SALES_DOCUMENT_UNRESOLVED_REASON_COPY`
 * (the SAME map the market rows and the readback's neighbouring surfaces
 * read) rather than inventing a second explanation of the same reason
 * vocabulary - the #2534 rule that a surface never re-derives a fact the
 * backend persists applies here too: the reason is the backend's, verbatim.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentDryRunResult } from '../api/sales-document-rules.types';
import { SALES_DOCUMENT_UNRESOLVED_REASON_COPY } from './sales-document-reasons';
import { getMessages, interpolate } from '../../../shared/i18n';

function documentKindLabel(documentKind: string | null | undefined): string {
  const copy = getMessages('sales-documents').dryRun.kind;
  if (documentKind === null) return copy.destinationDecides;
  if (documentKind === 'invoice') return copy.invoice;
  if (documentKind === 'fiscal-receipt') return copy.fiscalReceipt;
  if (documentKind === undefined) return copy.document;
  return interpolate(copy.other, { kind: documentKind });
}

export function describeSalesDocumentDryRunResult(
  result: SalesDocumentDryRunResult,
  connectionName: (connectionId: string) => string | null,
): string {
  const copy = getMessages('sales-documents').dryRun;
  if (result.kind === 'route') {
    const kind = documentKindLabel(result.documentKind);
    const where = result.connectionId
      ? (connectionName(result.connectionId) ?? result.connectionId)
      : copy.unknownConnection;
    // Three-valued, never a boolean: `country-default` must never render as
    // "an already-saved rule decided this" - the domain type is explicit
    // that a country default's absent `ruleId` must not imply a rule exists.
    const template =
      result.decidedBy === 'candidate'
        ? copy.routeCandidate
        : result.decidedBy === 'country-default'
          ? copy.routeCountryDefault
          : copy.routeSavedRule;
    return interpolate(template, { kind, where });
  }

  if (result.kind === 'aggregate') {
    return copy.aggregate;
  }

  // 'unresolved' - the backend types `reason` as a bare string (the same
  // untyped-wire-boundary shape `describeSalesDocumentMarketOutcome` already
  // accepts), so an unrecognised value falls back to a neutral statement
  // rather than throwing or rendering nothing.
  const reasonCopy = result.reason
    ? (SALES_DOCUMENT_UNRESOLVED_REASON_COPY as Record<string, { detail: string }>)[result.reason]
    : undefined;
  return reasonCopy?.detail ?? copy.held;
}
