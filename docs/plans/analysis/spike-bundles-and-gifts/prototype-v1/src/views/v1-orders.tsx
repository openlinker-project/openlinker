/**
 * v1 orders list, simple version: one status badge and at most one reason per
 * row; bundle and gift are small icons next to the product name; the reasons
 * behind "Wymaga uwagi" appear only after clicking that card.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { MetricCard } from '@web/shared/ui/metric-card';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Chip } from '@web/shared/ui/chip';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { TimeDisplay } from '@web/shared/ui/time-display';
import { QuickFilters, QuickFiltersLabel, QuickFiltersSeparator } from '@web/shared/ui/quick-filters';
import { CHANNELS } from '../model/catalog';
import { EUR_RATE, commonStates, useMoney, useProto, type ScreenDef, type StateDef } from '../proto';
import { BundleGlyph, GiftGlyph } from '../ui/marks';
import { LIST_ROWS, type ListRow } from './ord-data';
import './v1-ops.css';

type Health = 'all' | 'attention' | 'review' | 'ok';

/** New v1 order-detail state for each list row (the list data still carries app4 ids). */
const TARGET: Record<string, string> = {
  'gift-ol-only': 'gift-ol-only',
  'gift-out-of-stock': 'gift-out-of-stock',
  'gift-cart-rule': 'gift-from-channel',
  'gift-inferred': 'gift-from-channel',
  'gift-channel-flag': 'gift-from-channel',
  'multipack-held': 'multipack-held',
  'decrement-blocked': 'stock-problem',
  'bundle-edit-refused': 'stock-problem',
  'destination-refused-zero-line': 'stock-problem',
  'eur-order': 'eur-order',
  'bundle-allegro': 'bundle',
  'gift-removed-below-threshold': 'gift-not-added',
  'limit-reached': 'gift-not-added',
  'gift-wrap': 'gift-wrap',
};

/** One short reason per row, only when the order needs something. */
const REASON: Record<string, string> = {
  'gift-out-of-stock': 'Gratisu brak na stanie',
  multipack: 'Multipak bez zestawu',
  'decrement-blocked': 'Stan nie zszedł',
  'routing-refused': 'Brak składnika',
  'gift-rule-failed': 'Sklep odrzucił gratis',
  eur: 'Dokument czeka: EUR',
};

const GIFT_TITLE: Record<string, string> = {
  'channel-flag': 'Gratis oznaczony przez kanał',
  'cart-rule': 'Gratis z reguły koszyka',
  inferred: 'Gratis rozpoznany po cenie',
  'ol-rule': 'Gratis z promocji w OpenLinkerze',
  operator: 'Gratis dodany ręcznie',
};

function Identity({ r }: { r: ListRow }): ReactElement {
  const { go } = useProto();
  const hasGift = r.gift && r.gift !== 'none';
  return (
    <span className="v1o-cell">
      <ProductThumbnail name={r.firstItem} src={r.image} size="sm" />
      <span className="v1o-cell__body">
        <button type="button" className="ord-order-link v1o-link" onClick={() => go('order', TARGET[r.state] ?? 'bundle')}>
          {r.number}
        </button>
        <span className="v1o-cell__items">
          <span title={r.firstItem}>{r.firstItem}</span>
          {r.bundle ? (
            <span className="v1o-icon v1o-icon--bundle" title="Zestaw" aria-label="Zestaw" role="img">
              <BundleGlyph />
            </span>
          ) : null}
          {hasGift ? (
            <span className="v1o-icon v1o-icon--gift" title={GIFT_TITLE[r.gift as string]} aria-label={GIFT_TITLE[r.gift as string]} role="img">
              <GiftGlyph />
            </span>
          ) : null}
          {r.items > 1 ? <span className="v1o-muted">+{r.items - 1}</span> : null}
        </span>
        <span className="v1o-muted">
          {r.buyer}, {r.city}
        </span>
      </span>
    </span>
  );
}

function Status({ r }: { r: ListRow }): ReactElement {
  const reason = r.attention ? REASON[r.attention] : undefined;
  const badge = r.health.tone === 'error' ? r.health : r.health.tone === 'review' ? r.health : r.phase;
  return (
    <span className="v1o-status">
      <StatusBadge tone={badge.tone} withDot compact>
        {badge.label}
      </StatusBadge>
      {reason ? <span className="v1o-muted">{reason}</span> : null}
    </span>
  );
}

function OrdersView({ initial }: { initial: { health?: Health; gift?: boolean; bundle?: boolean } }): ReactElement {
  const { currency, go } = useProto();
  const money = useMoney();
  const [gift, setGift] = useState(initial.gift ?? false);
  const [bundle, setBundle] = useState(initial.bundle ?? false);
  const [health, setHealth] = useState<Health>(initial.health ?? 'all');
  const [reason, setReason] = useState<string | null>(null);
  const fmt = (g: number): string => (currency === 'EUR' ? money(Math.round(g / EUR_RATE), 'EUR') : money(g, 'PLN'));

  const attentionRows = LIST_ROWS.filter((r) => r.health.tone === 'error' || r.health.tone === 'review');
  const counts = useMemo(
    () => ({
      all: LIST_ROWS.length,
      attention: attentionRows.length,
      review: LIST_ROWS.filter((r) => r.health.tone === 'review').length,
      ok: LIST_ROWS.filter((r) => r.health.tone === 'success').length,
      gift: LIST_ROWS.filter((r) => r.gift && r.gift !== 'none').length,
      bundle: LIST_ROWS.filter((r) => r.bundle).length,
    }),
    [attentionRows.length],
  );
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of attentionRows) if (r.attention && REASON[r.attention]) m.set(r.attention, (m.get(r.attention) ?? 0) + 1);
    return [...m.entries()];
  }, [attentionRows]);

  const rows = LIST_ROWS.filter(
    (r) =>
      (!gift || (r.gift && r.gift !== 'none')) &&
      (!bundle || r.bundle) &&
      (health === 'all' ||
        (health === 'attention' && (r.health.tone === 'error' || r.health.tone === 'review') && (!reason || r.attention === reason)) ||
        (health === 'review' && r.health.tone === 'review') ||
        (health === 'ok' && r.health.tone === 'success')),
  );

  const columns: DataTableColumn<ListRow>[] = [
    { id: 'order', header: 'Zamówienie', lines: 3, cell: (r) => <Identity r={r} /> },
    { id: 'channel', header: 'Kanał', hideBelow: 1024, cell: (r) => <span>{CHANNELS[r.channel].name}</span> },
    { id: 'status', header: 'Status', cell: (r) => <Status r={r} /> },
    {
      id: 'money',
      header: 'Kwota',
      align: 'right',
      cell: (r) => (
        <span className="v1o-status" style={{ justifyItems: 'end' }}>
          <span className="tabular">{fmt(r.total)}</span>
          <span className="v1o-muted tabular">
            <TimeDisplay iso={r.createdAt} format="datetime" />
          </span>
        </span>
      ),
    },
  ];

  return (
    <PageLayout eyebrow="Sprzedaż" title="Zamówienia">
      <div className="v1o-stack">
        <div className="ds-grid ds-grid--4 orders-segments">
          {(
            [
              ['all', 'Wszystkie', 'neutral'],
              ['attention', 'Wymaga uwagi', 'error'],
              ['review', 'Do przeglądu', 'info'],
              ['ok', 'Bez problemów', 'success'],
            ] as const
          ).map(([key, label, tone]) => (
            <button
              key={key}
              type="button"
              className={['card-button-reset', 'orders-segment', health === key ? 'orders-segment--active' : ''].filter(Boolean).join(' ')}
              aria-pressed={health === key}
              onClick={() => {
                setHealth(key);
                setReason(null);
              }}
            >
              <MetricCard label={label} tone={tone} value={String(counts[key])} />
            </button>
          ))}
        </div>

        {health === 'attention' ? (
          <div className="v1o-reasons" role="group" aria-label="Powody">
            {reasons.map(([key, n]) => (
              <button key={key} type="button" className="v1o-reason" aria-pressed={reason === key} onClick={() => setReason(reason === key ? null : key)}>
                <span className="v1o-reason__n">{n}</span>
                <span>{REASON[key]}</span>
              </button>
            ))}
          </div>
        ) : null}

        <QuickFilters aria-label="Szybkie filtry">
          <QuickFiltersLabel>Pokaż</QuickFiltersLabel>
          <Chip active={gift} onClick={() => setGift(!gift)}>
            Z gratisem <span className="chip__count">{counts.gift}</span>
          </Chip>
          <Chip active={bundle} onClick={() => setBundle(!bundle)}>
            Z zestawem <span className="chip__count">{counts.bundle}</span>
          </Chip>
          <QuickFiltersSeparator />
          <span className="v1o-muted tabular">{rows.length} na liście</span>
        </QuickFilters>

        <DataTable
          caption="Zamówienia"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyState={
            <p className="v1o-muted">
              Żadne zamówienie nie pasuje do filtrów.{' '}
              <button type="button" className="v1o-link" onClick={() => { setGift(false); setBundle(false); setHealth('all'); setReason(null); go('orders', 'all'); }}>
                Wyczyść filtry
              </button>
            </p>
          }
        />
      </div>
    </PageLayout>
  );
}

const STATES: StateDef[] = [
  {
    id: 'all',
    label: 'Wszystkie',
    note: 'Jeden znacznik stanu i najwyżej jeden powód w wierszu. Zestaw i gratis to małe ikony przy nazwie produktu, z podpowiedzią po najechaniu. Filtry "Z gratisem" i "Z zestawem" zostają. Pod spodem: znaczniki biorą się z jednego pola na pozycji, które ustawia integracja kanału albo promocja w OpenLinkerze.',
    useCases: ['G-08', 'G-16', 'B-22', 'X-08', 'B-08', 'G-09', 'B-04', 'B-23'],
    priority: 'pilot',
  },
  {
    id: 'attention',
    label: 'Wymaga uwagi',
    note: 'Kafel "Wymaga uwagi" pokazuje powody dopiero po kliknięciu: gratisu brak, multipak bez zestawu, stan nie zszedł, brak składnika, sklep odrzucił gratis, dokument w EUR. Każdy powód filtruje listę. Zastępuje osobną ramkę uwag nad listą.',
    useCases: ['G-08', 'G-16', 'B-22', 'X-08', 'B-08', 'B-12', 'G-04'],
    priority: 'pilot',
  },
  {
    id: 'with-gift',
    label: 'Filtr: z gratisem',
    note: 'Szybki filtr pokazuje zamówienia z gratisem z dowolnego źródła: promocja w OpenLinkerze, reguła koszyka, flaga kanału, cena 0,01 zł.',
    useCases: ['G-09', 'G-16'],
    priority: 'pilot',
  },
  ...commonStates('zamówień', 'połącz pierwszy kanał sprzedaży'),
];

export const screen: ScreenDef = {
  id: 'orders',
  group: 'Sprzedaż',
  label: 'Zamówienia',
  states: STATES,
  render: (state) => <OrdersView key={state} initial={state === 'attention' ? { health: 'attention' } : state === 'with-gift' ? { gift: true } : {}} />,
};
