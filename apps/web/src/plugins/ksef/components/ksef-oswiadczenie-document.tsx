/**
 * KSeF oświadczenie document view (#1695)
 *
 * A full-screen overlay rendering the printable "oświadczenie o pominięciu
 * numeru faktury" as a styled paper sheet, with a toolbar (Print / Save as PDF,
 * Copy text, Close). Generated on the fly from a recorded gap note + the series
 * identity + the connection's seller profile — it is NOT persisted as a fiscal
 * document; the browser's print dialog (Save as PDF) is the artifact.
 *
 * The sheet is deliberately theme-independent (paper): it always renders light
 * regardless of the app theme. The overlay is portalled to `document.body` so
 * the `@media print` stylesheet can hide the rest of the app (`#root`) and print
 * only the sheet.
 *
 * @module plugins/ksef/components
 */
import { useCallback, useEffect, useMemo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { interpolate } from '../../../shared/i18n';
import { useKsefMessages } from '../messages';
import {
  buildOswiadczenieText,
  formatOswiadczenieBody,
  formatPlaceAndDate,
  formatSellerAddressLines,
  formatSellerNip,
  hasPrintableSeller,
  type KsefOswiadczenieContent,
} from '../lib/ksef-oswiadczenie';

interface KsefOswiadczenieDocumentProps {
  content: KsefOswiadczenieContent;
  onClose: () => void;
}

export function KsefOswiadczenieDocument({
  content,
  onClose,
}: KsefOswiadczenieDocumentProps): ReactElement {
  // Polish in every interface language: the toolbar belongs to the Polish document tool.
  const copy = useKsefMessages().oswiadczenie;
  const { showToast } = useToast();
  const issuedAt = useMemo(() => content.issuedAt ?? new Date(), [content.issuedAt]);
  const addressLines = formatSellerAddressLines(content.seller);
  const nip = formatSellerNip(content.seller);
  const sellerKnown = hasPrintableSeller(content.seller);

  // Escape closes the view (never leave the operator trapped in the overlay).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(buildOswiadczenieText(content)).then(
      () =>
        showToast({
          tone: 'success',
          title: copy.toolbar.copied.title,
          description: copy.toolbar.copied.description,
        }),
      () => showToast({ tone: 'error', description: copy.toolbar.copyFailed }),
    );
  }, [content, showToast, copy]);

  return createPortal(
    <div className="oswiadczenie-portal" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="oswiadczenie-toolbar">
        <div className="oswiadczenie-toolbar__group">
          <Button tone="primary" onClick={handlePrint}>
            {copy.toolbar.print}
          </Button>
          <Button tone="secondary" onClick={handleCopy}>
            {copy.toolbar.copy}
          </Button>
        </div>
        <Button tone="ghost" onClick={onClose}>
          {copy.toolbar.close}
        </Button>
      </div>

      <div className="oswiadczenie-scroll">
        <article className="oswiadczenie-sheet" aria-label={copy.sheetLabel}>
          <header className="oswiadczenie-sheet__seller">
            {sellerKnown ? (
              <>
                {content.seller.name.trim().length > 0 ? (
                  <p className="oswiadczenie-sheet__seller-name">{content.seller.name.trim()}</p>
                ) : null}
                {addressLines.map((line) => (
                  <p key={line} className="oswiadczenie-sheet__seller-line">
                    {line}
                  </p>
                ))}
                {nip.length > 0 ? (
                  <p className="oswiadczenie-sheet__seller-line">{interpolate(copy.nip, { nip })}</p>
                ) : null}
              </>
            ) : (
              <p className="oswiadczenie-sheet__seller-missing">
                {copy.sellerMissing}
              </p>
            )}
          </header>

          <p className="oswiadczenie-sheet__place-date">{formatPlaceAndDate(content.seller, issuedAt)}</p>

          <h1 className="oswiadczenie-sheet__title">{copy.title}</h1>

          <p className="oswiadczenie-sheet__body">{formatOswiadczenieBody(content)}</p>

          <p className="oswiadczenie-sheet__reason">
            <span className="oswiadczenie-sheet__reason-label">{copy.reasonLabel}</span>{' '}
            {content.reason}
          </p>

          <p className="oswiadczenie-sheet__continuity">{copy.continuity}</p>

          <dl className="oswiadczenie-sheet__series">
            <div>
              <dt>{copy.sheet.series}</dt>
              <dd>{content.seriesName}</dd>
            </div>
            <div>
              <dt>{copy.sheet.pattern}</dt>
              <dd className="oswiadczenie-sheet__mono">{content.seriesPattern}</dd>
            </div>
            <div>
              <dt>{copy.sheet.skippedNumber}</dt>
              <dd className="oswiadczenie-sheet__mono">{content.skippedNumber}</dd>
            </div>
          </dl>

          <div className="oswiadczenie-sheet__signature">
            <span className="oswiadczenie-sheet__signature-line" aria-hidden="true" />
            <span className="oswiadczenie-sheet__signature-caption">{copy.signature}</span>
          </div>
        </article>
      </div>
    </div>,
    document.body,
  );
}
