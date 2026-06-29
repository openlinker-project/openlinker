/**
 * KSeF Invoice Detail Section
 *
 * Per-provider `invoiceDetailSection` slot for KSeF connections (#1152, B4).
 * Rendered by the neutral `OrderInvoicePanel` and `InvoiceDetailPage` via
 * `usePlatform(connection.platformType).invoiceDetailSection` — ZERO
 * `platformType` literals here.
 *
 * Displays the KSeF-specific regulatory region:
 *   - KSeF clearance status via the neutral `RegulatoryStatusBadge`
 *   - The authority-assigned KSeF number (`clearanceReference`), falling back
 *     to the provider invoice number (`providerInvoiceNumber`) when the
 *     clearance reference is not yet populated.
 *
 * UPO download and FA(3) visualization are deferred to #1234 (B3/B5).
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import type { InvoiceDetailSectionProps } from '../../../shared/plugins';
import { RegulatoryStatusBadge } from '../../../features/invoicing';
import { useTranslation } from '../../../shared/i18n';

/**
 * Resolved KSeF number: prefer the authority-assigned clearance reference
 * (the 35-character KSeF number) over the provider invoice number which
 * is an internal document id assigned before clearance.
 */
function resolveKsefNumber(
  clearanceReference: string | null,
  providerInvoiceNumber: string | null,
): string | null {
  return clearanceReference ?? providerInvoiceNumber ?? null;
}

export function KsefInvoiceDetailSection({
  invoice,
}: InvoiceDetailSectionProps): ReactElement | null {
  const { t } = useTranslation();

  const ksefNumber = resolveKsefNumber(invoice.clearanceReference, invoice.providerInvoiceNumber);
  const hasRegulatoryData = invoice.regulatoryStatus !== 'not-applicable';

  // Nothing to show when there's no KSeF clearance data yet.
  if (!hasRegulatoryData && !ksefNumber) {
    return null;
  }

  return (
    <section className="invoice-detail-section invoice-detail-section--ksef">
      <h4 className="invoice-detail-section__title">
        {t('invoice.ksef.sectionTitle', 'KSeF · National e-Invoicing System')}
      </h4>
      <dl className="invoice-detail-section__kv">
        {hasRegulatoryData ? (
          <>
            <dt>{t('invoice.ksef.clearanceStatus', 'Clearance status')}</dt>
            <dd>
              <RegulatoryStatusBadge status={invoice.regulatoryStatus} />
            </dd>
          </>
        ) : null}
        {ksefNumber ? (
          <>
            <dt>{t('invoice.ksef.number', 'KSeF number')}</dt>
            <dd className="mono-text">{ksefNumber}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
