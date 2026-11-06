/**
 * Building blocks of the order detail view: header, lines table, stock paths,
 * gift panel, price panel and timeline. Built from the app's own classes
 * (order-header, order-totals, order-line-item) with Polish copy.
 */
import type { ReactElement, ReactNode } from 'react';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { DetailSection } from '@web/shared/ui/detail-section';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { CopyableId } from '@web/shared/ui/copyable-id';
import { TimeDisplay } from '@web/shared/ui/time-display';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { OrderLineItemIdentity } from '@web/features/orders/components/order-line-item-identity';
import { ActivityTimelineList } from '@web/features/orders/components/activity-timeline-list';
import type { TimelineEvent } from '@web/features/orders/components/order-activity-timeline';
import { CHANNELS, MASTERS, type GiftSource } from '../model/catalog';
import { EUR_RATE, useMoney, useProto, type Currency } from '../proto';
import { BundleMark, ChannelPayload, GiftGlyph, GiftMark, PartOf, StockPathTrail, WhoPaysStrip, type TrailStep } from '../ui/marks';
import {
  giftCostOf,
  isStockLine,
  lineImage,
  lineName,
  lineSku,
  listTotal,
  v,
  type Funder,
  type OrdLine,
  type OrdScenario,
} from './ord-data';

/* ── Money in the order's currency ─────────────────────────────────── */

export interface OrderMoney {
  fmt: (grosze: number) => string;
  cur: Currency;
  fx: number | undefined;
}

export function useOrderMoney(s: OrdScenario): OrderMoney {
  const money = useMoney();
  const { currency } = useProto();
  const cur: Currency = s.currency === 'EUR' || currency === 'EUR' ? 'EUR' : 'PLN';
  return {
    cur,
    fx: cur === 'EUR' ? EUR_RATE : undefined,
    fmt: (g) => (cur === 'EUR' ? money(Math.round(g / EUR_RATE), 'EUR') : money(g, 'PLN')),
  };
}

/* ── OMS reading ───────────────────────────────────────────────────── */

export function useEffectiveOms(s: OrdScenario): boolean {
  const { oms } = useProto();
  return s.forceOms ?? oms;
}

export const masterShort = (variant?: string): string => (variant ? (MASTERS[v(variant).master].id === 'subiekt' ? 'Subiekt GT' : 'PrestaShop') : 'PrestaShop');

/** Own shop of the stock master: the shop lowers its own stock, OpenLinker does not route it. */
export const isOwnShop = (s: OrdScenario): boolean => s.channel === 'prestashop';

export function trailFor(l: OrdLine, s: OrdScenario, oms: boolean): TrailStep[] {
  if (l.trail) return l.trail;
  const gift = l.kind === 'gift';
  if (l.removed) {
    return [
      { label: 'Zarezerwowano', state: 'done' },
      { label: 'Rezerwacja zwolniona', state: 'done', detail: 'stan wrócił do puli' },
    ];
  }
  if (isOwnShop(s)) {
    return [{ label: 'Sklep zdjął stan przy złożeniu zamówienia', state: 'done', detail: gift ? 'gratis z reguły koszyka to zwykła pozycja w sklepie' : undefined }];
  }
  const master = masterShort(l.variant);
  if (s.stage === 'cancelled') {
    return [
      { label: 'Zarezerwowano', state: 'done' },
      { label: 'Anulowano przed spakowaniem', state: 'done' },
      { label: 'Rezerwacja zwolniona', state: 'done', detail: `nic nie zeszło ze stanu w ${master}` },
    ];
  }
  const idx = { new: 0, reserved: 1, packing: 1, packed: 2, shipped: 3, cancelled: 0 }[s.stage];
  const st = (i: number): TrailStep['state'] => (i < idx ? 'done' : i === idx && (s.stage === 'new' || s.stage === 'packing' || s.stage === 'packed') ? 'active' : 'todo');
  if (oms) {
    return [
      { label: 'Zarezerwowano', state: st(0), detail: 'w OpenLinkerze' },
      { label: 'Spakowano', state: st(1), detail: 'skan na stanowisku' },
      { label: `Zdjęto ze stanu w ${master}`, state: st(2), detail: gift ? 'powód: gratis' : 'powód: sprzedaż' },
    ];
  }
  return [
    { label: `Wysłano do ${master} jako pozycja${gift ? ' 0,00 zł' : ''}`, state: s.stage === 'new' ? 'active' : 'done' },
    { label: 'Sklep zdjął stan', state: idx >= 2 ? 'done' : 'todo', detail: 'przy utworzeniu zamówienia w sklepie' },
  ];
}

/* ── Header ────────────────────────────────────────────────────────── */

export function OrdHeader({ s, oms }: { s: OrdScenario; oms: boolean }): ReactElement {
  const ch = CHANNELS[s.channel];
  const { fmt } = useOrderMoney(s);
  const first = s.lines[0];
  const items = s.lines.filter((l) => l.kind !== 'component' && l.kind !== 'ignored' && !(l.kind === 'gift' && l.partOf) && !l.removed);
  const units = items.reduce((a, l) => a + l.qty, 0);
  const dest = isOwnShop(s) ? `${ch.name} (sklep sam pakuje)` : oms ? 'OpenLinker (pakowanie)' : MASTERS.prestashop.name;
  const total = listTotal(s.lines) + s.adjustments.reduce((a, x) => a + x.amount, 0) + s.shipping;
  return (
    <header className="order-header">
      <div className="order-header__top">
        <h1 className="order-header__title">Zamówienie {s.number}</h1>
        <StatusBadge tone={s.health.tone} withDot>
          {s.health.label}
        </StatusBadge>
        <StatusBadge tone={s.phase.tone} withDot>
          {s.phase.label}
        </StatusBadge>
        <StatusBadge tone="neutral" withDot>
          {s.payment}
        </StatusBadge>
        {s.lines.some((l) => l.kind === 'bundle') ? <BundleMark /> : null}
        {s.lines.some((l) => l.kind === 'gift' && !l.removed) ? <GiftMark /> : null}
      </div>
      <div className="order-header__sub">
        <CopyableId id={`ol_order_${s.number.replace(/[^a-z0-9]/gi, '').toLowerCase()}7c1`} />
        <span className="order-route">
          <span className="order-route__node">
            <span className="order-route__dot" aria-hidden="true" />
            <span>{ch.name}</span>
            <span className="order-route__role">źródło</span>
          </span>
          <span className="order-route__arrow" aria-hidden="true">
            →
          </span>
          <span className="order-route__node">
            <span className="order-route__dot order-route__dot--accent" aria-hidden="true" />
            <span>{dest}</span>
            <span className="order-route__role">realizacja</span>
          </span>
        </span>
        <span className="order-header__received">
          Złożone <TimeDisplay iso={s.placedAt} format="datetime" className="mono-text tabular" />
        </span>
      </div>
      <div className="order-header__summary-line">
        <ProductThumbnail name={lineName(first)} src={lineImage(first)} size="sm" />
        <strong>
          {items.length} {items.length === 1 ? 'pozycja' : items.length < 5 ? 'pozycje' : 'pozycji'} · {units} szt.
        </strong>
        <span className="order-header__summary-sep">·</span>
        <span>
          {s.buyer}, {s.city}
        </span>
        <span className="order-header__summary-sep">·</span>
        <span className="mono-text tabular">{fmt(total)}</span>
      </div>
    </header>
  );
}

/* ── Lines table ───────────────────────────────────────────────────── */

const SOURCE_SHORT: Record<GiftSource, string> = {
  'channel-flag': 'kanał',
  'cart-rule': 'reguła koszyka',
  inferred: 'rozpoznany',
  'ol-rule': 'promocja OL',
  operator: 'operator',
};

function LineMarks({ l }: { l: OrdLine }): ReactElement | null {
  const parts: ReactNode[] = [];
  if (l.kind === 'bundle') parts.push(<BundleMark key="b" label={`Zestaw · wersja ${String(l.version ?? 1)}`} />);
  if (l.kind === 'gift') parts.push(<GiftMark key="g" source={l.partOf ? undefined : l.giftSource} />);
  if (l.partOf) parts.push(<PartOf key="p" bundle={l.partOf} />);
  if (l.olOnly) parts.push(<span key="o" className="ord-chip-quiet">tylko w OpenLinkerze</span>);
  if (l.kind === 'service') parts.push(<span key="s" className="ord-chip-quiet">usługa</span>);
  if (l.kind === 'ignored') parts.push(<span key="i" className="ord-chip-quiet">pominięta</span>);
  if (parts.length === 0 && !l.note && !l.vatLabel) return null;
  return (
    <span className="ord-line-extra">
      {parts.length ? <span className="ord-line-marks">{parts}</span> : null}
      {l.vatLabel ? <span className="ord-line-note">VAT {l.vatLabel}</span> : null}
      {l.note ? <span className="ord-line-note">{l.note}</span> : null}
    </span>
  );
}

function LineIdentity({ l }: { l: OrdLine }): ReactElement {
  return (
    <OrderLineItemIdentity
      name={lineName(l)}
      code={
        <>
          {lineSku(l)} <span className="ord-line-id">· {l.id}</span>
        </>
      }
      imageSrc={lineImage(l)}
      placeholderName={lineName(l)}
      extra={<LineMarks l={l} />}
    />
  );
}

function PriceCell({ l, m }: { l: OrdLine; m: OrderMoney }): ReactElement {
  if (l.kind === 'component' || (l.kind === 'gift' && l.partOf)) {
    return <span className="ord-muted tabular">{l.kind === 'gift' ? 'gratis w zestawie' : `udział ${m.fmt(l.share ?? 0)}`}</span>;
  }
  if (l.kind === 'ignored') return <span className="ord-muted tabular">0,00 · nie liczy się</span>;
  if (l.kind === 'gift') {
    const charged = l.unitPrice * l.qty;
    return (
      <span className="ord-price-stack tabular">
        <span>{m.fmt(l.giftSource === 'cart-rule' ? 0 : charged)}</span>
        <s className="ord-muted">{m.fmt((l.listPrice ?? 0) * l.qty)}</s>
        {l.giftSource === 'cart-rule' ? <span className="ord-muted">w sklepie {m.fmt(charged)}, rabat -{m.fmt(charged)}</span> : null}
      </span>
    );
  }
  return <span className="mono-text tabular">{m.fmt(l.unitPrice * l.qty)}</span>;
}

export function OrdLines({ s, onRowNote }: { s: OrdScenario; onRowNote?: (l: OrdLine) => ReactNode }): ReactElement {
  const m = useOrderMoney(s);
  const columns: DataTableColumn<OrdLine>[] = [
    { id: 'product', header: 'Produkt', cell: (l) => <LineIdentity l={l} /> },
    { id: 'qty', header: 'Ilość', align: 'right', cell: (l) => <span className="mono-text tabular">{l.qty}</span> },
    { id: 'unit', header: 'Cena', align: 'right', hideBelow: 1024, cell: (l) => (l.kind === 'goods' || l.kind === 'bundle' || l.kind === 'service' ? <span className="mono-text tabular">{m.fmt(l.unitPrice)}</span> : <span className="ord-muted">-</span>) },
    { id: 'value', header: 'Wartość', align: 'right', cell: (l) => <PriceCell l={l} m={m} /> },
    {
      id: 'state',
      header: 'Rezerwacja',
      cell: (l) =>
        l.removed ? (
          <StatusBadge tone="neutral" compact>
            Usunięta
          </StatusBadge>
        ) : l.status ? (
          <StatusBadge tone={l.status.tone} withDot compact>
            {l.status.label}
          </StatusBadge>
        ) : l.kind === 'bundle' ? (
          <span className="ord-muted">na składnikach</span>
        ) : l.kind === 'service' ? (
          <span className="ord-muted">bez stanu</span>
        ) : (
          <span className="ord-muted">-</span>
        ),
    },
  ];
  if (onRowNote) columns.push({ id: 'act', header: '', align: 'right', cell: (l) => onRowNote(l) });
  return (
    <DataTable
      caption="Pozycje zamówienia"
      columns={columns}
      rows={s.lines}
      rowKey={(l) => l.id}
      rowClassName={(l) =>
        [
          l.kind === 'component' || (l.kind === 'gift' && l.partOf) ? 'ord-row--child' : '',
          l.kind === 'gift' ? 'ord-row--gift' : '',
          l.removed || l.kind === 'ignored' ? 'ord-row--struck' : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      cardView={{
        title: (l) => <LineIdentity l={l} />,
        subtitle: (l) => (
          <span className="ord-card-sub">
            <span className="mono-text tabular">{l.qty} szt.</span>
            <PriceCell l={l} m={m} />
          </span>
        ),
        meta: (l) =>
          l.status ? (
            <StatusBadge tone={l.status.tone} withDot compact>
              {l.status.label}
            </StatusBadge>
          ) : null,
        actions: onRowNote ? (l) => onRowNote(l) : undefined,
      }}
    />
  );
}

/* ── Stock paths ───────────────────────────────────────────────────── */

export function OrdStock({ s, title = 'Gdzie idzie stan' }: { s: OrdScenario; title?: string }): ReactElement {
  const oms = useEffectiveOms(s);
  const stockLines = s.lines.filter((l) => isStockLine(l) || l.removed);
  const bundles = s.lines.filter((l) => l.kind === 'bundle');
  return (
    <DetailSection
      title={title}
      titleAside={
        <span className="ord-muted">
          {isOwnShop(s) ? 'sklep zdejmuje stan sam' : oms ? 'OMS włączony: pakuje OpenLinker' : 'OMS wyłączony: pakuje sklep'}
        </span>
      }
    >
      {bundles.length ? (
        <p className="proto-inline-note">
          Zestaw nie ma własnego stanu. Rezerwacja, pakowanie i zdjęcie stanu idą na każdym składniku osobno.
        </p>
      ) : null}
      <ul className="ord-stock">
        {stockLines.map((l) => (
          <li key={l.id} className={`ord-stock__row${l.kind === 'gift' ? ' ord-stock__row--gift' : ''}`}>
            <span className="ord-stock__who">
              <span className="ord-stock__name">
                {lineName(l)} <span className="ord-muted tabular">x{l.qty}</span>
              </span>
              <span className="ord-stock__marks">
                {l.kind === 'gift' ? <GiftMark compact /> : null}
                {l.partOf ? <PartOf bundle={l.partOf} /> : null}
                <span className="ord-line-id">{l.id}</span>
              </span>
            </span>
            <StockPathTrail steps={trailFor(l, s, oms)} />
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/* ── Gift panel ────────────────────────────────────────────────────── */

export function giftExplainer(l: OrdLine, s: OrdScenario, oms: boolean): { title: string; body: string } {
  const ch = CHANNELS[s.channel];
  const master = masterShort(l.variant);
  if (l.partOf) {
    return { title: 'Gratis w składzie zestawu', body: `${lineName(l)} jest w zestawie "${l.partOf}" jako gratis. Klient płaci tylko za zestaw. Gratis ma własną rezerwację i pakowacz skanuje go jak każdy składnik.` };
  }
  if (l.giftSource === 'cart-rule') {
    return { title: 'Gratis z reguły koszyka PrestaShop', body: 'PrestaShop przysłał tę pozycję jak zwykły towar w pełnej cenie, a rabat zapisał na całym zamówieniu w regułach koszyka. OpenLinker połączył rabat z pozycją i pokazuje ją jako gratis. Kwota zamówienia się nie zmienia.' };
  }
  if (l.giftSource === 'inferred') {
    return { title: 'Gratis rozpoznany po cenie', body: `${ch.name} nie oznacza gratisów. Aplikacja z gratisami dodaje wariant za 0,01 zł. OpenLinker rozpoznał go po Twojej regule w ustawieniach połączenia.` };
  }
  if (l.giftSource === 'channel-flag') {
    return s.channel === 'empik'
      ? { title: 'Gratis oznaczony przez Empik', body: 'Empik podał ilość gratisową w polu offered_quantity. Kanał nie mówi, kto finansuje gratis, więc koszt liczymy jako Twój, dopóki tego nie ustawisz.' }
      : { title: `Gratis oznaczony przez ${ch.name}`, body: `${ch.name} oznaczył tę pozycję jako gratis (orderSalesMode: gift). OpenLinker niczego nie zgaduje.` };
  }
  const who = l.giftSource === 'operator' ? 'Operator dodał' : 'Promocja w OpenLinkerze dodała';
  if (ch.giftSupport === 'none') {
    return {
      title: `${ch.name} nie ma gratisów`,
      body: oms
        ? `Kupujący nie widzi tego gratisu w zamówieniu na ${ch.name}. OpenLinker dopisał go do zamówienia, zarezerwował i zdejmie ze stanu w ${master} po spakowaniu.`
        : `Kupujący nie widzi tego gratisu w zamówieniu na ${ch.name}. OpenLinker dopisał go do zamówienia i wyśle do ${master} jako pozycję 0,00 zł. Sklep sam zdejmie stan.`,
    };
  }
  return { title: 'Gratis dodany w OpenLinkerze', body: `${who} ten gratis. Kanał go nie zna.` };
}

export function OrdGiftPanel({ s, lines }: { s: OrdScenario; lines?: OrdLine[] }): ReactElement | null {
  const oms = useEffectiveOms(s);
  const m = useOrderMoney(s);
  const gifts = (lines ?? s.lines).filter((l) => l.kind === 'gift' && !l.removed);
  if (gifts.length === 0) return null;
  return (
    <DetailSection title={gifts.length > 1 ? 'Gratisy w tym zamówieniu' : 'Gratis w tym zamówieniu'}>
      <div className="ord-gifts">
        {gifts.map((l) => {
          const ex = giftExplainer(l, s, oms);
          return (
            <div key={l.id} className="ord-gift">
              <div className="ord-gift__head">
                <ProductThumbnail name={lineName(l)} src={lineImage(l)} size="sm" />
                <span className="ord-gift__name">
                  {lineName(l)} <span className="ord-muted tabular">x{l.qty}</span>
                </span>
                <GiftMark source={l.partOf ? undefined : l.giftSource} />
              </div>
              <WhoPaysStrip qty={l.qty} unitCost={l.variant ? v(l.variant).cost : null} buyerPays={m.cur === 'EUR' ? Math.round((l.giftSource === 'inferred' ? l.unitPrice * l.qty : 0) / EUR_RATE) : l.giftSource === 'inferred' ? l.unitPrice * l.qty : 0} funder={l.funder} currency={m.cur} fx={m.fx} />
              <div className="ord-explainer">
                <span className="ord-explainer__icon" aria-hidden="true">
                  <GiftGlyph />
                </span>
                <span>
                  <strong className="ord-explainer__title">{ex.title}</strong>
                  <span className="ord-explainer__body">{ex.body}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

/* ── Price panel ───────────────────────────────────────────────────── */

const FUNDER_LABEL: Record<Funder | 'none', string> = {
  seller: 'finansujesz Ty',
  channel: 'finansuje kanał',
  unknown: 'kanał nie podał, kto finansuje',
  none: '',
};

export function OrdPrice({ s }: { s: OrdScenario }): ReactElement {
  const m = useOrderMoney(s);
  const money = useMoney();
  const { role } = useProto();
  const list = listTotal(s.lines);
  const paid = list + s.adjustments.reduce((a, x) => a + x.amount, 0) + s.shipping;
  const cost = giftCostOf(s.lines);
  const hasGift = s.lines.some((l) => l.kind === 'gift' && !l.removed);
  return (
    <DetailSection className="ord-price" title="Ceny i kto płaci" titleAside={m.cur === 'EUR' ? <span className="ord-muted">kurs 1 EUR = 4,2500 PLN</span> : undefined}>
      <dl className="order-totals">
        <div className="order-totals__row">
          <dt>Cena katalogowa pozycji</dt>
          <dd className="mono-text">{m.fmt(list)}</dd>
        </div>
        {s.adjustments.map((a) => (
          <div className="order-totals__row" key={a.label}>
            <dt>
              {a.label}
              <span className="ord-funder">
                {FUNDER_LABEL[a.funder]}
                {a.note ? ` · ${a.note}` : ''}
              </span>
            </dt>
            <dd className="mono-text">-{m.fmt(-a.amount)}</dd>
          </div>
        ))}
        {s.shipping > 0 ? (
          <div className="order-totals__row">
            <dt>Dostawa</dt>
            <dd className="mono-text">{m.fmt(s.shipping)}</dd>
          </div>
        ) : null}
        <div className="order-totals__row order-totals__row--total">
          <dt>Klient zapłacił</dt>
          <dd className="mono-text">{m.fmt(paid)}</dd>
        </div>
        {hasGift && role !== 'packer' ? (
          <div className="order-totals__row ord-totals-cost">
            <dt>
              Koszt gratisów dla Ciebie
              <span className="ord-funder">koszt zakupu netto, w PLN</span>
            </dt>
            <dd className="mono-text">{cost === null ? 'koszt nieznany' : money(cost, 'PLN')}</dd>
          </div>
        ) : null}
      </dl>
    </DetailSection>
  );
}

/* ── Delivery, payload, writeback, timeline ────────────────────────── */

export function OrdDelivery({ s }: { s: OrdScenario }): ReactElement {
  const m = useOrderMoney(s);
  return (
    <DetailSection title="Dostawa">
      <KeyValueList
        items={[
          { id: 'method', label: 'Metoda', value: s.delivery },
          { id: 'to', label: 'Odbiorca', value: `${s.buyer}, ${s.city}` },
          { id: 'cost', label: 'Koszt dostawy', value: m.fmt(s.shipping), mono: true },
        ]}
      />
    </DetailSection>
  );
}

export function OrdPayload({ s }: { s: OrdScenario }): ReactElement | null {
  if (!s.payload) return null;
  return (
    <DetailSection title="Co przysłał kanał">
      <ChannelPayload title={s.payload.title} lines={s.payload.lines} />
    </DetailSection>
  );
}

export function OrdWriteback({ s }: { s: OrdScenario }): ReactElement {
  const ch = CHANNELS[s.channel];
  const rows = s.lines.filter((l) => l.kind === 'bundle' || l.kind === 'goods' || (l.kind === 'gift' && !l.partOf));
  return (
    <DetailSection title={`Co wyślemy do ${ch.name}`} titleAside={<span className="ord-muted">numer przesyłki, status, zwroty</span>}>
      <ul className="ord-wb">
        {rows.map((l) => (
          <li key={l.id} className="ord-wb__row">
            <span className="ord-wb__name">
              {lineName(l)} <span className="ord-line-id">{l.id}</span>
            </span>
            {l.olOnly ? (
              <span className="ord-wb__state">
                <StatusBadge tone="neutral" compact>
                  Pominięta
                </StatusBadge>
                <span className="ord-muted">istnieje tylko w OpenLinkerze</span>
              </span>
            ) : (
              <span className="ord-wb__state">
                <StatusBadge tone="info" withDot compact>
                  Wysyłamy
                </StatusBadge>
                <span className="ord-muted">pozycja {ch.name}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="proto-inline-note">
        {ch.name} dostanie status "Wysłane" i numer przesyłki dla swoich pozycji. Zwrot i zwrot pieniędzy też nie obejmą gratisu, bo kupujący go nie kupił.
      </p>
    </DetailSection>
  );
}

export function OrdTimeline({ s, extra = [] }: { s: OrdScenario; extra?: TimelineEvent[] }): ReactElement {
  const events: TimelineEvent[] = [
    ...s.timeline.map((e, i) => ({ id: `${s.id}-${String(i)}`, timestamp: e.at, title: e.title, by: e.by, description: e.desc, tone: e.tone ?? 'default' })),
    ...extra,
  ];
  return (
    <DetailSection title="Historia">
      <ActivityTimelineList events={events} ariaLabel="Historia zamówienia" />
    </DetailSection>
  );
}

export { SOURCE_SHORT };
