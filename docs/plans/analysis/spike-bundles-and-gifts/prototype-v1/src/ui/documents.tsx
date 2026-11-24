/**
 * Full receipt and invoice previews (the app only has a delivery-line preview).
 * Built from a DocResult so the lines always sum to the total.
 */
import type { ReactElement } from 'react';
import { Alert } from '@web/shared/ui/alert';
import { DocumentKindGlyph } from '@web/shared/ui/document-kind-glyph';
import type { DocResult } from '../model/calc';
import { useMoney } from '../proto';
import { GiftMark } from './marks';

const PL_LETTER: Record<number, string> = { 23: 'A', 8: 'B', 5: 'C', 0: 'D' };

export function ReceiptPreview({ doc, title = 'Paragon fiskalny', seller = 'Kawowy Świat sp. z o.o.' }: { doc: DocResult; title?: string; seller?: string }): ReactElement {
  const money = useMoney();
  return (
    <section className="proto-doc proto-doc--receipt" aria-label={title}>
      <header className="proto-doc__head">
        <DocumentKindGlyph kind="fiscal-receipt" decorative />
        <span>{title}</span>
      </header>
      {doc.status !== 'ready' ? (
        <Alert tone={doc.status === 'refused' ? 'error' : 'warning'} density="compact" title={doc.status === 'refused' ? 'Paragon nie zostanie wydrukowany' : 'Paragon wstrzymany'}>
          {doc.reason}
        </Alert>
      ) : null}
      <div className={`receipt${doc.status !== 'ready' ? ' receipt--void' : ''}`} aria-hidden={doc.status !== 'ready' ? true : undefined}>
        <p className="receipt__seller">{seller}</p>
        <p className="receipt__nip">NIP 525-255-61-07</p>
        <p className="receipt__banner">PARAGON FISKALNY</p>
        <ul className="receipt__lines">
          {doc.lines.map((l, i) => (
            <li key={i} className={`receipt__line receipt__line--${l.kind}`}>
              <span className="receipt__name">{l.name}</span>
              <span className="receipt__calc tabular">
                {l.qty} x {money(l.unitGross, 'PLN').replace(/\s?zł/, '')} = {money(l.gross, 'PLN').replace(/\s?zł/, '')} {PL_LETTER[l.vat] ?? '?'}
              </span>
              {l.note ? <span className="receipt__note">{l.note}</span> : null}
            </li>
          ))}
        </ul>
        <div className="receipt__rates">
          {doc.perRate.map((r) => (
            <span key={r.rate} className="tabular">
              SPRZEDAŻ OPOD. {PL_LETTER[r.rate]} {money(r.gross, 'PLN').replace(/\s?zł/, '')} · PTU {r.rate}% {money(r.vat, 'PLN').replace(/\s?zł/, '')}
            </span>
          ))}
        </div>
        <p className="receipt__total tabular">
          <span>SUMA PLN</span>
          <span>{money(doc.total, 'PLN').replace(/\s?zł/, '')}</span>
        </p>
      </div>
      {doc.internalRecord ? (
        <div className="proto-doc__internal">
          <GiftMark compact />
          <span>
            Gratis nie jest na paragonie. OpenLinker zapisuje go w ewidencji nieodpłatnych przekazań: {doc.internalRecord.name}, {doc.internalRecord.qty} szt., koszt {money(doc.internalRecord.costNet, 'PLN')} netto, stawka {doc.internalRecord.vat}%.
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function InvoicePreview({ doc, number = 'FV 2026/11/0412', buyer = 'Anna Kowalska, ul. Lipowa 4, 00-001 Warszawa', p10 }: { doc: DocResult; number?: string; buyer?: string; p10?: boolean }): ReactElement {
  const money = useMoney();
  return (
    <section className="proto-doc proto-doc--invoice" aria-label={`Faktura ${number}`}>
      <header className="proto-doc__head">
        <DocumentKindGlyph kind="invoice" decorative />
        <span>Faktura {number}</span>
      </header>
      {doc.status !== 'ready' ? (
        <Alert tone="warning" density="compact" title="Faktura wstrzymana">
          {doc.reason}
        </Alert>
      ) : null}
      <div className={`invoice${doc.status !== 'ready' ? ' invoice--void' : ''}`}>
        <div className="invoice__parties">
          <span><strong>Sprzedawca</strong> Kawowy Świat sp. z o.o., NIP 5252556107</span>
          <span><strong>Nabywca</strong> {buyer}</span>
        </div>
        <div className="data-table__container">
          <table className="data-table invoice__table">
            <thead>
              <tr>
                <th scope="col">Nazwa</th>
                <th scope="col" className="data-table__cell--right">Ilość</th>
                <th scope="col" className="data-table__cell--right">Cena brutto</th>
                {p10 ? <th scope="col" className="data-table__cell--right">Opust (P_10)</th> : null}
                <th scope="col" className="data-table__cell--right">VAT</th>
                <th scope="col" className="data-table__cell--right">Wartość brutto</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i} className={l.kind === 'component' ? 'invoice__row--component' : undefined}>
                  <th scope="row">
                    {l.name}
                    {l.note ? <span className="spike-note">{l.note}</span> : null}
                  </th>
                  <td className="data-table__cell--right tabular">{l.qty}</td>
                  <td className="data-table__cell--right tabular">{money(l.unitGross, 'PLN')}</td>
                  {p10 ? <td className="data-table__cell--right tabular">{l.kind === 'gift' ? money(0, 'PLN') : '-'}</td> : null}
                  <td className="data-table__cell--right tabular">{l.vat}%</td>
                  <td className="data-table__cell--right tabular">{money(l.gross, 'PLN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="invoice__sums">
          {doc.perRate.map((r) => (
            <span key={r.rate} className="tabular">
              Stawka {r.rate}%: brutto {money(r.gross, 'PLN')}, VAT {money(r.vat, 'PLN')}
            </span>
          ))}
          <strong className="tabular">Razem do zapłaty: {money(doc.total, 'PLN')}</strong>
        </div>
      </div>
    </section>
  );
}
