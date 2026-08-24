/**
 * Derive Sales-Document Country Status (#2187)
 *
 * Pure status-badge computation for `SalesDocumentCountryIndex`'s Status
 * column. Three states, checked in this precedence order:
 *
 *   1. `ruleCount > 0`, or either country default is set → "Configured"
 *      (`StatusBadge` tone `success`, no dot).
 *   2. Else `acknowledgedNoDocumentAt !== null` → "No document · by design"
 *      (tone `neutral`, no dot — a badge shape, not a dot, so it can't be
 *      confused with the idle "Not configured" neighbor below).
 *   3. Else → "Not configured" (tone `neutral`, `withDot: true` — the same
 *      idle-dot convention used elsewhere, e.g. the `pending` badge in
 *      `bulk-batch-progress-table.tsx`).
 *
 * `★ Rest of world` carries its own additional "Always on · catch-all"
 * badge on top of whichever of the three states above applies — that badge
 * is rendered by the component, not this function, since it depends on the
 * country literal rather than the summary's own fields.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';

export const SALES_DOCUMENT_COUNTRY_STATUS_VALUES = [
  'configured',
  'no-document-by-design',
  'not-configured',
] as const;
export type SalesDocumentCountryStatus = (typeof SALES_DOCUMENT_COUNTRY_STATUS_VALUES)[number];

export interface SalesDocumentCountryStatusBadge {
  status: SalesDocumentCountryStatus;
  label: string;
  tone: StatusBadgeTone;
  withDot: boolean;
}

type SalesDocumentCountryStatusInput = Pick<
  SalesDocumentCountrySummary,
  'ruleCount' | 'invoiceDefaultConnectionId' | 'receiptDefaultConnectionId' | 'acknowledgedNoDocumentAt'
>;

export function deriveSalesDocumentCountryStatus(
  summary: SalesDocumentCountryStatusInput,
): SalesDocumentCountryStatusBadge {
  const isConfigured =
    summary.ruleCount > 0 ||
    summary.invoiceDefaultConnectionId !== null ||
    summary.receiptDefaultConnectionId !== null;

  if (isConfigured) {
    return { status: 'configured', label: 'Configured', tone: 'success', withDot: false };
  }

  if (summary.acknowledgedNoDocumentAt !== null) {
    return {
      status: 'no-document-by-design',
      label: 'No document · by design',
      tone: 'neutral',
      withDot: false,
    };
  }

  return { status: 'not-configured', label: 'Not configured', tone: 'neutral', withDot: true };
}
