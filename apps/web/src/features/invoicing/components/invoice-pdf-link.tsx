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
        aria-label={t('invoice.pdf.aria', 'Open invoice PDF (opens in new tab)')}
      >
        <span className="mono-text">{invoiceNumber}</span>
      </a>
    );
  }

  return <span className="mono-text">{invoiceNumber}</span>;
}
