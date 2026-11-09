/**
 * SubiektInvoiceDetailSection (#1241)
 *
 * Per-provider `invoiceDetailSection` slot for Subiekt. Subiekt transmits
 * invoices to KSeF natively — OpenLinker reads the clearance status from
 * Subiekt (#1230) and links the PDF Subiekt renders. The slot is hidden when
 * neither regulatory data nor a PDF URL is present (nothing to show).
 *
 * @module plugins/subiekt-nexo/components
 */
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins/plugin.types';
import {
  RegulatoryStatusBadge,
  regCardToneFor,
  type RegulatoryStatus,
} from '../../../features/invoicing';
import { useSubiektNexoMessages } from '../messages';

const NON_APPLICABLE: RegulatoryStatus = 'not-applicable';

export function SubiektInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const copy = useSubiektNexoMessages().subiektInvoiceDetailSection;

  const hasRegulatoryData = invoice.regulatoryStatus !== NON_APPLICABLE;
  const hasPdf = Boolean(invoice.pdfUrl);

  if (!hasRegulatoryData && !hasPdf) return null;

  return (
    <section
      className={`detail-section reg-card ${regCardToneFor(invoice.regulatoryStatus)}`.trim()}
    >
      <h2 className="detail-section__title">{copy.title}</h2>
      <p className="text-muted" style={{ fontSize: '12px', margin: '0 0 var(--space-3)' }}>
        {copy.note}
      </p>
      <dl className="invoice-panel__kv">
        {hasRegulatoryData ? (
          <>
            <dt>{copy.ksefStatus}</dt>
            <dd>
              <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
              <span className="text-muted" style={{ fontSize: '11px', marginLeft: '6px' }}>
                {copy.readFrom}
              </span>
            </dd>

            <dt>{copy.ksefNumber}</dt>
            <dd className="mono-text">
              {invoice.clearanceReference ?? invoice.providerInvoiceNumber ?? (
                <span className="text-muted">
                  {copy.pending}
                </span>
              )}
            </dd>
          </>
        ) : null}

        {hasPdf ? (
          <>
            <dt>{copy.pdf}</dt>
            <dd>
              <a
                href={invoice.pdfUrl ?? ''}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                {copy.downloadPdf}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
