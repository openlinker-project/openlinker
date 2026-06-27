/**
 * SubiektInvoiceDetailSection (#1241)
 *
 * Per-provider `invoiceDetailSection` slot for Subiekt. Subiekt transmits
 * invoices to KSeF natively — OpenLinker reads the clearance status from
 * Subiekt (#1230) and links the PDF Subiekt renders. The slot is hidden when
 * neither regulatory data nor a PDF URL is present (nothing to show).
 *
 * @module plugins/subiekt/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins/plugin.types';
import {
  RegulatoryStatusBadge,
  type RegulatoryStatus,
} from '../../../features/invoicing';

const NON_APPLICABLE: RegulatoryStatus = 'not-applicable';

export function SubiektInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();

  const hasRegulatoryData = invoice.regulatoryStatus !== NON_APPLICABLE;
  const hasPdf = Boolean(invoice.pdfUrl);

  if (!hasRegulatoryData && !hasPdf) return null;

  return (
    <section className="detail-section">
      <h2 className="detail-section__title">
        {t('subiekt.invoice.detail.title', 'Regulatory status')}
      </h2>
      <p className="text-muted" style={{ fontSize: '12px', margin: '0 0 var(--space-3)' }}>
        {t(
          'subiekt.invoice.detail.note',
          "Subiekt sent this to KSeF itself — OpenLinker reads the status, it doesn't transmit.",
        )}
      </p>
      <dl className="invoice-panel__kv">
        {hasRegulatoryData ? (
          <>
            <dt>{t('subiekt.invoice.detail.ksefStatus', 'KSeF status')}</dt>
            <dd>
              <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
              <span className="text-muted" style={{ fontSize: '11px', marginLeft: '6px' }}>
                {t('subiekt.invoice.detail.readFrom', 'read from Subiekt')}
              </span>
            </dd>

            <dt>{t('subiekt.invoice.detail.ksefNumber', 'KSeF number')}</dt>
            <dd className="mono-text">
              {invoice.clearanceReference ?? invoice.providerInvoiceNumber ?? (
                <span className="text-muted">
                  {t('subiekt.invoice.detail.pending', 'Pending')}
                </span>
              )}
            </dd>
          </>
        ) : null}

        {hasPdf ? (
          <>
            <dt>{t('subiekt.invoice.detail.pdf', 'Invoice PDF')}</dt>
            <dd>
              <a
                href={invoice.pdfUrl ?? ''}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                {t('subiekt.invoice.detail.downloadPdf', 'Download PDF')}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
