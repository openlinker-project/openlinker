/**
 * Orders list: bundle and gift tags in the status group, quick filters
 * "Z gratisem" / "Z zestawem", and an attention inbox above the table.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { MetricCard } from '@web/shared/ui/metric-card';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Chip } from '@web/shared/ui/chip';
import { DetailSection } from '@web/shared/ui/detail-section';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { TimeDisplay } from '@web/shared/ui/time-display';
import { QuickFilters, QuickFiltersLabel, QuickFiltersSeparator } from '@web/shared/ui/quick-filters';
import { useToast } from '@web/shared/ui/toast-provider';
import { ConnectionChip } from '@web/features/connections/components/ConnectionChip';
import { CHANNELS } from '../model/catalog';
import { EUR_RATE, commonStates, useMoney, useProto, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, GiftMark } from '../ui/marks';
import { INBOX, LIST_ROWS, type ListRow } from './ord-data';
import './ord.css';

type Health = 'all' | 'attention' | 'review' | 'ok';

const GIFT_TITLE: Record<string, string> = {
  'channel-flag': 'Gratis oznaczony przez kanał',
  'cart-rule': 'Gratis z reguły koszyka sklepu',
  inferred: 'Gratis rozpoznany po cenie',
  'ol-rule': 'Gratis z promocji w OpenLinkerze',
  operator: 'Gratis dodany przez operatora',
};

function OrdIdentity({ r }: { r: ListRow }): ReactElement {
  const { go } = useProto();
  return (
    <span className="order-cell">
      <ProductThumbnail name={r.firstItem} src={r.image} size="sm" />
      <span className="order-cell__body">
        <button type="button" className="ord-order-link" onClick={() => go('order', r.state)}>
          {r.number}
        </button>
        <span className="orders-items-line">
          <span className="text-muted orders-cell-sub orders-items-preview" title={r.firstItem}>
            {r.firstItem}
          </span>
          {r.items > 1 ? <span className="orders-more-count">+{r.items - 1}</span> : null}
        </span>
        <span className="text-muted orders-cell-sub">
          {r.buyer}, {r.city}
        </span>
      </span>
    </span>
  );
}

function ChannelCell({ r }: { r: ListRow }): ReactElement {
  const ch = CHANNELS[r.channel];
  return (
    <span className="orders-cell-stack">
      <ConnectionChip connectionId={`conn-${r.channel}`} name={`${ch.name} (Kawowy Świat)`} channel={{ platformType: r.channel, label: ch.name }} />
      <span className="text-muted orders-cell-sub">→ {r.dest}</span>
    </span>
  );
}

function StatusCell({ r }: { r: ListRow }): ReactElement {
  return (
    <span className="orders-cell-stack">
      <StatusBadge tone={r.health.tone} withDot compact>
        {r.health.label}
      </StatusBadge>
      <StatusBadge tone={r.phase.tone} compact>
        {r.phase.label}
      </StatusBadge>
      {r.bundle || (r.gift && r.gift !== 'none') ? (
        <span className="ord-row-marks">
          {r.bundle ? <BundleMark compact /> : null}
          {r.gift && r.gift !== 'none' ? (
            <span title={GIFT_TITLE[r.gift]}>
              <GiftMark compact />
            </span>
          ) : null}
        </span>
      ) : null}
      {r.hold ? (
        <StatusBadge tone="warning" compact>
          Wstrzymane: {r.hold}
        </StatusBadge>
      ) : null}
      {r.stockRisk ? (
        <StatusBadge tone="error" compact>
          {r.stockRisk}
        </StatusBadge>
      ) : null}
      {r.packing ? <span className="text-muted orders-cell-sub">Pakowanie: {r.packing.toLowerCase()}</span> : null}
      {r.edited ? (
        <StatusBadge tone="neutral" compact>
          Edytowane w OpenLinkerze
        </StatusBadge>
      ) : null}
    </span>
  );
}

function OrdersView({ initial }: { initial: { gift?: boolean; bundle?: boolean; attention?: boolean } }): ReactElement {
  const { go, currency } = useProto();
  const money = useMoney();
  const { showToast } = useToast();
  const [gift, setGift] = useState(initial.gift ?? false);
  const [bundle, setBundle] = useState(initial.bundle ?? false);
  const [health, setHealth] = useState<Health>(initial.attention ? 'attention' : 'all');
  const fmt = (g: number): string => (currency === 'EUR' ? money(Math.round(g / EUR_RATE), 'EUR') : money(g, 'PLN'));

  const counts = useMemo(
    () => ({
      all: LIST_ROWS.length,
      attention: LIST_ROWS.filter((r) => r.health.tone === 'error').length,
      review: LIST_ROWS.filter((r) => r.health.tone === 'review').length,
      ok: LIST_ROWS.filter((r) => r.health.tone === 'success').length,
      gift: LIST_ROWS.filter((r) => r.gift && r.gift !== 'none').length,
      bundle: LIST_ROWS.filter((r) => r.bundle).length,
    }),
    [],
  );

  const rows = LIST_ROWS.filter(
    (r) =>
      (!gift || (r.gift && r.gift !== 'none')) &&
      (!bundle || r.bundle) &&
      (health === 'all' || (health === 'attention' && r.health.tone === 'error') || (health === 'review' && r.health.tone === 'review') || (health === 'ok' && r.health.tone === 'success')),
  );

  const columns: DataTableColumn<ListRow>[] = [
    { id: 'order', header: 'Zamówienie i klient', lines: 3, cell: (r) => <OrdIdentity r={r} /> },
    { id: 'channel', header: 'Kanał', hideBelow: 1024, cell: (r) => <ChannelCell r={r} /> },
    { id: 'status', header: 'Status', cell: (r) => <StatusCell r={r} /> },
    {
      id: 'money',
      header: 'Kwota',
      align: 'right',
      cell: (r) => (
        <span className="orders-cell-stack orders-cell-stack--end">
          <span className="mono tabular orders-money-total">{fmt(r.total)}</span>
          <span className="text-muted orders-cell-sub mono tabular">
            <TimeDisplay iso={r.createdAt} format="datetime" />
          </span>
        </span>
      ),
    },
  ];

  const inboxTotal = INBOX.reduce((a, i) => a + i.count, 0);

  return (
    <PageLayout
      eyebrow="Sprzedaż"
      title="Zamówienia"
      actions={
        <div className="button-group">
          <Button tone="ghost" className="button--sm" onClick={() => showToast({ tone: 'info', title: 'Odświeżono', description: 'Lista zamówień jest aktualna.' })}>
            Odśwież
          </Button>
        </div>
      }
    >
      <div className="ds-grid ds-grid--4 orders-segments">
        {(
          [
            ['all', 'Wszystkie', 'neutral'],
            ['attention', 'Wymaga uwagi', 'error'],
            ['review', 'Do przeglądu', 'info'],
            ['ok', 'Zsynchronizowane', 'success'],
          ] as const
        ).map(([key, label, tone]) => (
          <button
            key={key}
            type="button"
            className={['card-button-reset', 'orders-segment', health === key ? 'orders-segment--active' : ''].filter(Boolean).join(' ')}
            aria-pressed={health === key}
            onClick={() => setHealth(key)}
          >
            <MetricCard label={label} tone={tone} value={String(counts[key])} />
          </button>
        ))}
      </div>

      <DetailSection
        className="ord-inbox"
        title="Zestawy i gratisy: wymaga uwagi"
        titleAside={<span className="ord-muted tabular">{inboxTotal} zamówień</span>}
      >
        <ul className="ord-inbox__list">
          {INBOX.map((i) => (
            <li key={i.key} className="ord-inbox__row">
              <span className={`ord-inbox__count ord-inbox__count--${i.tone} tabular`}>{i.count}</span>
              <span className="ord-inbox__text">
                <span className="ord-inbox__title">{i.title}</span>
                <span className="ord-inbox__hint">{i.hint}</span>
              </span>
              <Button tone="secondary" className="button--sm" onClick={() => go(i.screen, i.state)}>
                Pokaż
              </Button>
            </li>
          ))}
        </ul>
      </DetailSection>

      <QuickFilters
        aria-label="Szybkie filtry"
        end={
          gift || bundle || health !== 'all' ? (
            <button
              type="button"
              className="ord-link"
              onClick={() => {
                setGift(false);
                setBundle(false);
                setHealth('all');
              }}
            >
              Wyczyść filtry
            </button>
          ) : undefined
        }
      >
        <QuickFiltersLabel>Pokaż</QuickFiltersLabel>
        <Chip active={gift} onClick={() => setGift(!gift)}>
          Z gratisem <span className="chip__count">{counts.gift}</span>
        </Chip>
        <Chip active={bundle} onClick={() => setBundle(!bundle)}>
          Z zestawem <span className="chip__count">{counts.bundle}</span>
        </Chip>
        <QuickFiltersSeparator />
        <span className="ord-muted tabular">{rows.length} zamówień na liście</span>
      </QuickFilters>

      <DataTable
        caption="Zamówienia"
        className="orders-table"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyState={<p className="ord-muted">Żadne zamówienie nie pasuje do filtrów.</p>}
        cardView={{
          title: (r) => <OrdIdentity r={r} />,
          subtitle: (r) => (
            <span className="orders-card-sub">
              {CHANNELS[r.channel].name} → {r.dest} · <TimeDisplay iso={r.createdAt} format="relative" />
            </span>
          ),
          summary: (r) => (
            <div className="ord-card-summary">
              <StatusCell r={r} />
              <span className="mono tabular orders-money-total">{fmt(r.total)}</span>
            </div>
          ),
          actions: (r) => (
            <Button tone="ghost" className="button--sm" onClick={() => go('order', r.state)}>
              Otwórz
            </Button>
          ),
        }}
      />
    </PageLayout>
  );
}

const STATES: StateDef[] = [
  { id: 'all', label: 'Wszystkie', note: 'Lista zamówień. Zestaw i gratis mają własne znaczniki w grupie statusu, obok zdrowia i fazy zamówienia. Najedź na znacznik gratisu, żeby zobaczyć jego źródło. Kliknij numer zamówienia, żeby otworzyć szczegóły.', useCases: ['G-08', 'G-16', 'B-22', 'X-08', 'B-08'], priority: 'pilot' },
  { id: 'filtered-gift', label: 'Filtr: z gratisem', note: 'Szybki filtr "Z gratisem" zostawia zamówienia z gratisem z dowolnego źródła: oznaczonym przez kanał, z reguły koszyka, rozpoznanym po cenie albo dodanym w OpenLinkerze.', useCases: ['G-09', 'G-16'], priority: 'pilot' },
  { id: 'filtered-bundle', label: 'Filtr: z zestawem', note: 'Szybki filtr "Z zestawem" pokazuje zamówienia, w których co najmniej jedna pozycja to zestaw rozłożony na składniki.', useCases: ['B-04', 'B-23'], priority: 'pilot' },
  { id: 'attention', label: 'Wymaga uwagi', note: 'Skrzynka uwag zbiera problemy zestawów i gratisów: gratis bez stanu, reguła nie zadziałała, zablokowane zdjęcie stanu paka PrestaShop, routing odmówił na składniku, zamówienie w EUR do przeglądu, wstrzymany multipak. "Pokaż" otwiera przykładowe zamówienie w tym stanie.', useCases: ['G-08', 'G-16', 'B-22', 'X-08', 'B-08'], priority: 'pilot' },
  ...commonStates('zamówień', 'połącz kanał sprzedaży'),
];

export const screen: ScreenDef = {
  id: 'orders',
  group: 'Sprzedaż',
  label: 'Zamówienia',
  states: STATES,
  render: (state) => <OrdersView key={state} initial={{ gift: state === 'filtered-gift', bundle: state === 'filtered-bundle', attention: state === 'attention' }} />,
};
