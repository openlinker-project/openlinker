/**
 * Building blocks of the documents lab: the "sum equals paid" check, the bundle
 * split table, the internal gift record, the before/after rounding pair and the
 * EUR review panel.
 */
import type { ReactElement, ReactNode } from 'react';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { DetailSection } from '@web/shared/ui/detail-section';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { DocumentHeadline } from '@web/shared/ui/document-headline';
import { Alert } from '@web/shared/ui/alert';
import { VARIANTS } from '../model/catalog';
import type { DocResult } from '../model/calc';
import { EUR_RATE, useMoney } from '../proto';
import { GiftMark } from '../ui/marks';
import { EUR_ORDER, ratesOf, bundleSplit } from './doc-data';

/** "Suma dokumentu = zapłacono", computed. */
export function SumCheck({ doc, paid }: { doc: DocResult; paid: number }): ReactElement {
  const money = useMoney();
  const diff = doc.total - paid;
  return (
    <div className="doc-lab-check" data-ok={diff === 0 ? 'true' : 'false'}>
      <StatusBadge tone={diff === 0 ? 'success' : 'warning'} compact withDot>
        {diff === 0 ? 'Zgadza się' : 'Nie zgadza się'}
      </StatusBadge>
      <span className="tabular">
        Suma dokumentu {money(doc.total, 'PLN')} {diff === 0 ? '=' : '≠'} zapłacono {money(paid, 'PLN')}
        {diff !== 0 ? `, różnica ${money(Math.abs(diff), 'PLN')}` : ''}
      </span>
    </div>
  );
}

export function PreviewCell({ caption, children }: { caption?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="doc-lab-cell">
      {children}
      {caption ? <div className="proto-inline-note">{caption}</div> : null}
    </div>
  );
}

interface SplitRow {
  variant: string;
  name: string;
  qty: number;
  standalone: number;
  share: number;
  vat: number;
  gift: boolean;
  overStandalone: boolean;
}

/** How the bundle price was split (B-14), with per-rate sums. */
export function BundleSplitTable({ bundle }: { bundle: 'morning' | 'brew' }): ReactElement {
  const money = useMoney();
  const rows: SplitRow[] = bundleSplit(bundle);
  const rates = ratesOf(rows.filter((r) => !r.gift).map((r) => ({ name: r.name, qty: r.qty, unitGross: r.share, gross: r.share, vat: r.vat, kind: 'component' as const })));
  const columns: DataTableColumn<SplitRow>[] = [
    { id: 'name', header: 'Składnik', cell: (r) => <span className="doc-lab-name">{r.name}{r.gift ? <GiftMark compact /> : null}</span> },
    { id: 'qty', header: 'Ilość', align: 'right', cell: (r) => <span className="tabular">{r.qty}</span> },
    { id: 'standalone', header: 'Cena osobno', align: 'right', cell: (r) => <span className="tabular">{money(r.standalone, 'PLN')}</span>, hideBelow: 768 },
    { id: 'share', header: 'Udział w cenie zestawu', align: 'right', cell: (r) => <span className="tabular">{money(r.share, 'PLN')}</span> },
    { id: 'vat', header: 'Stawka', align: 'right', cell: (r) => <span className="tabular">{r.vat}%</span> },
    {
      id: 'cap',
      header: 'Nie więcej niż osobno',
      cell: (r) => (r.gift ? <span className="text-muted">gratis, 0,00 zł</span> : <StatusBadge tone={r.overStandalone ? 'error' : 'success'} compact>{r.overStandalone ? 'Ponad cenę osobno' : 'Tak'}</StatusBadge>),
      hideBelow: 1024,
    },
  ];
  return (
    <DetailSection title="Podział ceny zestawu" titleAside="zamrożony przy sprzedaży">
      <DataTable
        caption="Udział każdego składnika w cenie zestawu, proporcjonalnie do cen osobno"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.variant}
        cardView={{ title: (r) => r.name, subtitle: (r) => `${r.qty} szt., stawka ${r.vat}%`, meta: (r) => <span className="tabular">{money(r.share, 'PLN')}</span> }}
      />
      <ul className="doc-lab-rates">
        {rates.map((r) => (
          <li key={r.rate} className="tabular">
            Stawka {r.rate}%: brutto {money(r.gross, 'PLN')}, VAT {money(r.vat, 'PLN')}
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/** "Ewidencja nieodpłatnych przekazań" (G-19, D-07). */
export function InternalRecordPanel({ doc }: { doc: DocResult }): ReactElement | null {
  const money = useMoney();
  const rec = doc.internalRecord;
  if (!rec) return null;
  const small = rec.costNet / rec.qty <= 2000;
  return (
    <DetailSection title="Ewidencja nieodpłatnych przekazań" titleAside="dokument wewnętrzny, nie dla klienta">
      <KeyValueList
        items={[
          { id: 'no', label: 'Wpis', value: 'EW/2026/11/0031', mono: true },
          { id: 'date', label: 'Data przekazania', value: '4 listopada 2026' },
          { id: 'order', label: 'Zamówienie', value: 'Allegro 8812-4410-0921', mono: true },
          { id: 'item', label: 'Towar', value: <span className="doc-lab-name">{rec.name}<GiftMark compact /></span> },
          { id: 'qty', label: 'Ilość', value: <span className="tabular">{rec.qty} szt.</span> },
          { id: 'cost', label: 'Cena nabycia netto', value: <span className="tabular">{money(rec.costNet, 'PLN')}</span> },
          { id: 'vat', label: 'Stawka gratisu', value: `${rec.vat}%` },
          { id: 'promo', label: 'Promocja', value: 'Łyżeczka gratis do zestawu porannego, wersja 2' },
          {
            id: 'small',
            label: 'Prezent o małej wartości',
            value: small ? 'Cena nabycia poniżej 20 zł netto (art. 7 ust. 4 pkt 2). Odbiorca nie jest zapisywany.' : 'Cena nabycia powyżej 20 zł netto. Potrzebna ewidencja odbiorców albo VAT od ceny nabycia.',
          },
        ]}
      />
      <p className="proto-inline-note">Ten wpis nie trafia do kasy ani do KSeF. Rejestr odbiorców do 100 zł rocznie wymaga danych osobowych, więc jest osobnym ustawieniem.</p>
    </DetailSection>
  );
}

/** EUR order from Erli with German VAT (X-08): flagged for review, no PLN document issued. */
export function EurReviewPanel(): ReactElement {
  const money = useMoney();
  const total = EUR_ORDER.lines.reduce((a, l) => a + l.unitGross * l.qty, 0);
  return (
    <div className="doc-lab-stack">
      <Alert tone="warning" title="Brak trasy dokumentu dla tego zamówienia">
        Erli przysłało zamówienie na rynek niemiecki w EUR ze stawkami 7% i 19%. Żaden skonfigurowany dostawca nie wystawia dokumentu w EUR z niemieckim VAT, więc zamówienie dostaje zwykłą blokadę "brak trasy dokumentu". Paragon w PLN z polskimi stawkami byłby błędny, dlatego nic nie wychodzi. Docelowo: automatyczna faktura OSS, tak jak robi to Shoper.
      </Alert>
      <div className="doc-lab-previews">
        <DetailSection title="Co przysłał kanał">
          <KeyValueList
            items={[
              { id: 'no', label: 'Zamówienie', value: EUR_ORDER.number, mono: true },
              { id: 'market', label: 'Rynek', value: 'de (Niemcy)' },
              { id: 'cur', label: 'Waluta', value: 'EUR' },
              { id: 'country', label: 'Kraj stawki', value: 'DE, nie PL' },
              ...EUR_ORDER.lines.map((l, i) => ({
                id: `l${i}`,
                label: `${l.qty} x ${l.name}`,
                value: <span className="tabular">{money(l.unitGross * l.qty, 'EUR')}, {l.taxRate} ({l.rate}% DE)</span>,
              })),
              { id: 'total', label: 'Razem', value: <span className="tabular">{money(total, 'EUR')} (około {money(Math.round(total * EUR_RATE), 'PLN')} po kursie {EUR_RATE.toFixed(4).replace('.', ',')})</span> },
            ]}
          />
        </DetailSection>
        <DetailSection title="Dokumenty">
          <div className="doc-lab-stack">
            <DocumentHeadline kind="fiscal-receipt" state="Nie wystawiono" tone="warning" identity="eparagony.pl wystawia tylko w PLN" />
            <DocumentHeadline kind="invoice" state="Do przeglądu" tone="warning" identity="kraj stawki DE, waluta EUR" />
            <p className="proto-inline-note">
              Dostawca, który nie wystawia dokumentów w EUR albo dla nabywcy z Niemiec, nie dostaje tego zamówienia: routing odmawia z nazwanym powodem. Zamówienia zapisane wcześniej jako PLN trafiają na listę do przeglądu, a wystawionych dokumentów OpenLinker sam nie przelicza.
            </p>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

/** One gift line at a glance for the WhoPays strip. */
export function giftPaidOnDoc(doc: DocResult): number {
  return doc.lines.filter((l) => l.kind === 'gift').reduce((a, l) => a + l.gross, 0);
}

export function giftUnitCost(variant: string): number | null {
  return VARIANTS[variant].cost;
}
