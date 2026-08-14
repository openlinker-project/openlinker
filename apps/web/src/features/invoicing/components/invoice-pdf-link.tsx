/**
 * Invoice PDF Link (#757)
 *
 * Renders the issued invoice's `providerInvoiceNumber` as either an external
 * link to `pdfUrl` OR copy-text-only, mirroring `ShipmentTrackingLink`.
 *
 * SECURITY (plan §1.9): `pdfUrl` is adapter-controlled and reaches the FE with
 * NO server-side scheme validation. React JSX does not sanitize `href`, so the
 * FE treats it as untrusted and renders the anchor only when the scheme is
 * `http:` / `https:`. Any other scheme (`javascript:`, `data:`, …) or malformed
 * value degrades to copy-text — a `javascript:`-scheme `pdfUrl` NEVER becomes an
 * `href`.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { isSafeHttpUrl } from '../../../shared/lib/is-safe-http-url';

interface InvoicePdfLinkProps {
  invoiceNumber: string | null;
  pdfUrl: string | null;
}

export function InvoicePdfLink({ invoiceNumber, pdfUrl }: InvoicePdfLinkProps): ReactElement {
  const { t } = useTranslation();

  if (pdfUrl && isSafeHttpUrl(pdfUrl)) {
    return (
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="invoice-pdf-link"
        aria-label={t(
        'invoice.pdf.aria',
        // The number, not just "invoice PDF": `aria-label` overrides the
        // name-from-content, so without it a 20-row page exposes 20 links with
        // identical accessible names and a screen reader's link list is useless
        // (#2090). Doubly so now the number is a merged identity cell's headline.
        `Open invoice PDF for ${invoiceNumber} (opens in new tab)`,
      )}
      >
        <span className="mono-text">{invoiceNumber}</span>
      </a>
    );
  }

  return <span className="mono-text">{invoiceNumber}</span>;
}
