/**
 * "Koszt gratisów" tab: KPI strip, aggregate who-pays strip, cost coverage note,
 * breakdown per promotion / per channel, and the PL small-gift register panel.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { AnalyticsKpiCard } from '@web/features/analytics/components/analytics-kpi-card';
import { GapMark } from '@web/features/analytics/components/gap-mark';
import { Alert } from '@web/shared/ui/alert';
import { Button } from '@web/shared/ui/button';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { EmptyState } from '@web/shared/ui/feedback-state';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { useToast } from '@web/shared/ui/toast-provider';
import { useFormat } from '@web/shared/i18n/use-format';
import { CHANNELS, VARIANTS, type Channel } from '../model/catalog';
import { SMALL_GIFT_UNIT_LIMIT, SMALL_GIFT_YEAR_LIMIT } from '../model/calc';
import { Note, useMoney, useProto, useWriteGuard } from '../proto';
import { GiftMark, Switch } from '../ui/marks';
import { AggregateWhoPays, Amount, AnaPanel, BasisNote, ShareBar, WeeklyBars, useAmount } from './ana-shared';
import { giftFigures, promoStatusLabel, recipientTotals, RECIPIENTS, SAMPLE_NO_COST_UNITS, OPERATOR_GIFTS, OVERLAP_ORDERS, unitLimitRows, WEEKS, type GiftRow, type GiftFigures } from './ana-data';

export type GiftsMode = 'overview' | 'cost-unknown' | 'register' | 'by-channel' | 'empty';
type Breakdown = 'promo' | 'channel' | 'register';

const PROMO_TONE: Record<string, StatusBadgeTone> = {
  active: 'success', draft: 'neutral', paused: 'warning', 'budget-reached': 'warning', ended: 'neutral', manual: 'info',
};

const GIFT_SUPPORT: Record<Channel['giftSupport'], string> = {
  none: 'Kanał nie ma gratisów. Gratis istnieje tylko w OpenLinker.',
  'cart-rule': 'Reguła koszyka. Gratis przychodzi jako zwykła pozycja.',
  plugin: 'Gratis przez wtyczkę sklepu.',
  'app-price': 'Aplikacja z ceną 0,01-1 zł, bez oznaczenia.',
  'native-flag': 'Kanał oznacza gratis.',
};

export function GiftsTab({ mode }: { mode: GiftsMode }): ReactElement {
  const { go } = useProto();
  const guard = useWriteGuard();
  if (mode === 'empty') {
    return (
      <EmptyState
        title="Nie wydano jeszcze żadnego gratisu"
        message="Koszt gratisów pojawi się tu, gdy pierwsza promocja doda gratis do zamówienia albo operator doda go ręcznie. OpenLinker liczy koszt po cenie zakupu wariantu z dnia wydania."
        action={
          <Button disabled={!guard.canWrite} title={guard.reason} onClick={() => go('promotions')}>
            Utwórz promocję
          </Button>
        }
      />
    );
  }
  return <GiftsBody mode={mode} />;
}

function GiftsBody({ mode }: { mode: Exclude<GiftsMode, 'empty'> }): ReactElement {
  const withGaps = mode === 'cost-unknown';
  const f = useMemo(() => giftFigures(withGaps), [withGaps]);
  const [breakdown, setBreakdown] = useState<Breakdown>(mode === 'by-channel' ? 'channel' : mode === 'register' ? 'register' : 'promo');
  return (
    <div className="ana-stack">
      <BasisNote>Koszt gratisu to koszt zakupu netto z dnia wydania, bo koszty wpisuje się netto. Anulowane zamówienia pominięte.</BasisNote>
      <GiftKpis f={f} withGaps={withGaps} />
      <AggregateWhoPays units={f.given} cost={f.knownCost} unknownUnits={f.unknownUnits} />
      {f.unknownUnits > 0 ? <CostCoverageNote f={f} /> : null}
      <div className="toolbar ana-subbar">
        <div className="toolbar__group">
          <SegmentedControl
            aria-label="Podział kosztu gratisów"
            options={[
              { value: 'promo', label: 'Według promocji' },
              { value: 'channel', label: 'Według kanału' },
              { value: 'register', label: 'Rejestr małych prezentów' },
            ]}
            value={breakdown}
            onChange={setBreakdown}
          />
        </div>
      </div>
      {breakdown === 'promo' ? <PromotionsTable f={f} /> : breakdown === 'channel' ? <ChannelsTable f={f} /> : <SmallGiftRegister />}
    </div>
  );
}

/* ── KPI strip ─────────────────────────────────────────────────────── */

function GiftKpis({ f, withGaps }: { f: GiftFigures; withGaps: boolean }): ReactElement {
  const fmt = useFormat();
  const amt = useAmount();
  const perOrder = Math.round(f.knownCost / f.ordersUnique);
  const share = f.knownCost / f.marginBefore;
  const basis = 'vs 35 dni wcześniej';
  const budgeted = f.rows.filter((r) => r.budget !== null && (r.status === 'active' || r.status === 'draft'));
  const budgetLeft = budgeted.reduce((a, r) => a + Math.max(0, (r.budget ?? 0) - r.spent), 0);
  const budgetSpent = f.rows.filter((r) => r.budget !== null).reduce((a, r) => a + r.spent, 0);
  const gapTitle = `${fmt.number(f.unknownUnits)} szt. bez kosztu zakupu, nie wliczone w koszt`;
  return (
    <section className="status-strip status-strip--analytics" aria-label="Najważniejsze liczby gratisów">
      <AnalyticsKpiCard
        label="Gratisy wydane"
        infotipLabel="Jak liczymy wydane gratisy"
        definitions={[{ term: 'Gratisy wydane', text: 'Sztuki gratisów w zamówieniach z okresu: z promocji, reguł kanału i dodane przez operatora. Gratis w zestawie jest liczony w analizie zestawów.' }]}
        metric="sztuki w zamówieniach"
        value={fmt.number(f.given)}
        delta={{ formatted: '62,0%', tone: 'neutral', direction: 'up', basisLabel: basis, spokenText: 'Wzrost o 62 procent względem 35 dni wcześniej' }}
        qualifiers={[
          { label: 'Zamówienia z gratisem', value: <span className="tabular">{fmt.number(f.ordersUnique)}</span> },
          { label: 'Aktywne promocje', value: <span className="tabular">2</span> },
        ]}
      />
      <AnalyticsKpiCard
        label="Koszt gratisów netto"
        infotipLabel="Jak liczymy koszt gratisów"
        definitions={[{ term: 'Koszt gratisów', text: 'Suma kosztu zakupu netto wydanych gratisów, z dnia wydania. Gratis bez kosztu zakupu nie jest liczony jako zero, tylko pokazany osobno.', formula: 'Σ sztuki x koszt zakupu netto' }]}
        metric={withGaps ? <>bez {fmt.number(f.unknownUnits)} szt. o nieznanym koszcie <GapMark title={gapTitle} /></> : 'koszt zakupu, netto'}
        value={amt(f.knownCost)}
        trend={{ values: f.weeklyCost, tone: 'neutral', ariaLabel: 'Koszt gratisów tydzień po tygodniu' }}
        delta={{ formatted: '58,1%', tone: 'neutral', direction: 'up', basisLabel: basis, spokenText: 'Wzrost o 58,1 procent względem 35 dni wcześniej' }}
        qualifiers={[
          { label: 'Średnio na gratis', value: <span className="tabular">{amt(Math.round(f.knownCost / Math.max(1, f.given - f.unknownUnits)))}</span> },
          { label: 'Najwięcej kosztuje', value: 'Próbka kawy' },
        ]}
      />
      <AnalyticsKpiCard
        label="Koszt na zamówienie z gratisem"
        infotipLabel="Koszt na zamówienie"
        definitions={[{ term: 'Koszt na zamówienie', text: `Koszt gratisów podzielony przez zamówienia, które dostały gratis. Zamówienie z dwoma gratisami (${OVERLAP_ORDERS} takich) liczy się raz.` }]}
        metric="koszt gratisów / zamówienia z gratisem"
        value={amt(perOrder)}
        delta={{ formatted: '4,0%', tone: 'success', direction: 'down', basisLabel: basis, spokenText: 'Spadek o 4 procent względem 35 dni wcześniej' }}
      />
      <AnalyticsKpiCard
        label="Udział w marży"
        infotipLabel="Udział gratisów w marży"
        definitions={[{ term: 'Udział w marży', text: 'Jaką część marży brutto zamówień z gratisem zjadły gratisy. Marża liczona przed kosztem gratisów, na przychodzie netto.', formula: 'koszt gratisów / marża zamówień z gratisem' }]}
        metric={withGaps ? <>marży zamówień z gratisem, bez kosztu nieznanego <GapMark title={gapTitle} /></> : 'marży zamówień z gratisem'}
        value={fmt.percent(share)}
        delta={{ formatted: '0,8 pp', tone: 'error', direction: 'up', basisLabel: basis, spokenText: 'Wzrost o 0,8 punktu procentowego względem 35 dni wcześniej' }}
        qualifiers={[{ label: 'Marża po gratisach', value: <span className="tabular">{amt(f.marginBefore - f.knownCost)}</span> }]}
      />
      <AnalyticsKpiCard
        label="Gratisy bez kosztu"
        infotipLabel="Gratisy bez kosztu zakupu"
        definitions={[{ term: 'Gratisy bez kosztu', text: 'Sztuki gratisów, dla których OpenLinker nie zna kosztu zakupu. Nie są w koszcie, w udziale w marży ani w limitach rejestru małych prezentów.' }]}
        metric={f.unknownUnits > 0 ? 'nie wliczone w koszt' : 'wszystkie gratisy mają koszt'}
        value={fmt.number(f.unknownUnits)}
        valueSuffix="szt."
        delta={{ formatted: f.unknownUnits > 0 ? `${fmt.number(f.unknownUnits)} szt.` : '0 szt.', tone: f.unknownUnits > 0 ? 'error' : 'neutral', direction: f.unknownUnits > 0 ? 'up' : 'flat', basisLabel: basis, spokenText: f.unknownUnits > 0 ? `Przybyło ${f.unknownUnits} sztuk bez kosztu` : 'Bez zmian' }}
      />
      <AnalyticsKpiCard
        label="Budżet promocji do wydania"
        infotipLabel="Budżet promocji"
        definitions={[{ term: 'Budżet do wydania', text: 'Suma budżetów promocji aktywnych i w szkicu minus to, co już wydały. Promocja bez budżetu nie ma limitu i nie jest tu liczona.' }]}
        metric="aktywne i szkice z budżetem"
        value={amt(budgetLeft)}
        delta={{ formatted: '1 promocja', tone: 'neutral', direction: 'flat', basisLabel: 'wyczerpała budżet', spokenText: 'Jedna promocja wyczerpała budżet' }}
        qualifiers={[{ label: 'Wydano z budżetów', value: <span className="tabular">{amt(budgetSpent)}</span> }]}
      />
    </section>
  );
}

/* ── Cost coverage note (mirrors MarginCoverageNote) ───────────────── */

function CostCoverageNote({ f }: { f: GiftFigures }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const fmt = useFormat();
  const guard = useWriteGuard();
  const { go } = useProto();
  const samplePrice = VARIANTS.sample.price;
  return (
    <div className="analytics-margin__coverage">
      <div>
        <button type="button" className="chip chip--warning excl-note" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {fmt.number(f.unknownUnits)} szt. gratisów ma nieznany koszt · nie są w koszcie ani w rejestrze małych prezentów
        </button>
      </div>
      <div id={id} className="analytics-margin__coverage-detail data-table__container" hidden={!open}>
        <table className="data-table">
          <caption className="sr-only">Dlaczego część gratisów nie ma kosztu</caption>
          <thead>
            <tr>
              <th>Powód</th>
              <th>Gratis</th>
              <th className="analytics-margin__num">Sztuki</th>
              <th className="analytics-margin__num">Wartość katalogowa</th>
              <th>Co zrobić</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Koszt wpisany po sprzedaży. Zamówienia przyjęte wcześniej zostają bez kosztu, OpenLinker nie dopisuje go wstecz.</td>
              <td>{VARIANTS.sample.name}</td>
              <td className="analytics-margin__num tabular">{fmt.number(SAMPLE_NO_COST_UNITS)}</td>
              <td className="analytics-margin__num"><Amount grosze={samplePrice * SAMPLE_NO_COST_UNITS} /></td>
              <td>Nic dla tych zamówień. Nowe mają już koszt.</td>
            </tr>
            <tr>
              <td>Brak kosztu zakupu w Subiekt GT. Gratis dodany ręcznie przez operatora.</td>
              <td>{VARIANTS[OPERATOR_GIFTS.variant].name}</td>
              <td className="analytics-margin__num tabular">{fmt.number(OPERATOR_GIFTS.qty)}</td>
              <td className="analytics-margin__num"><Amount grosze={VARIANTS[OPERATOR_GIFTS.variant].price * OPERATOR_GIFTS.qty} /></td>
              <td>
                <Button tone="ghost" disabled={!guard.canWrite} title={guard.reason} onClick={() => go('catalog')}>
                  Uzupełnij koszt
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="data-table__footnote">Gratis bez kosztu nigdy nie jest liczony jako tańszy niż 20 zł ani wliczany do limitu 100 zł. W rejestrze dostaje stan „koszt nieznany”.</p>
      </div>
    </div>
  );
}

/* ── Per promotion ─────────────────────────────────────────────────── */

function CostCell({ row }: { row: GiftRow }): ReactElement {
  const fmt = useFormat();
  if (row.cost === null) {
    return <span className="ana-unknown">koszt nieznany</span>;
  }
  return (
    <>
      <Amount grosze={row.cost} strong />
      {row.unknownUnits > 0 ? (
        <div className="ana-unknown ana-small">
          + {fmt.number(row.unknownUnits)} szt. bez kosztu <GapMark title="Te sztuki nie mają kosztu zakupu i nie są w kwocie powyżej" />
        </div>
      ) : null}
    </>
  );
}

function ChannelSplit({ channels }: { channels: GiftRow['channels'] }): ReactElement {
  const fmt = useFormat();
  const entries = Object.entries(channels).filter(([, n]) => (n ?? 0) > 0);
  if (entries.length === 0) return <span className="muted-text">-</span>;
  return (
    <span className="ana-split">
      {entries.map(([id, n]) => (
        <span key={id} className="ana-split__item">
          <span className="ana-dot" style={{ background: `var(${CHANNELS[id as keyof typeof CHANNELS].colorVar})` }} aria-hidden="true" />
          {CHANNELS[id as keyof typeof CHANNELS].name} <span className="tabular">{fmt.number(n ?? 0)}</span>
        </span>
      ))}
    </span>
  );
}

function BudgetCell({ row }: { row: GiftRow }): ReactElement {
  const amt = useAmount();
  if (row.source === 'operator') return <span className="muted-text">poza promocją</span>;
  if (row.budget === null) return <span className="muted-text">bez limitu</span>;
  const left = Math.max(0, row.budget - row.spent);
  return (
    <span className="data-table__stack">
      <span className="tabular mono-text">{amt(left)}</span>
      <span className="muted-text ana-small">z {amt(row.budget)}</span>
      <ShareBar value={row.spent / row.budget} tone="gift" />
    </span>
  );
}

function PromotionsTable({ f }: { f: GiftFigures }): ReactElement {
  const fmt = useFormat();
  const amt = useAmount();
  const { go } = useProto();
  const columns: DataTableColumn<GiftRow>[] = [
    {
      id: 'name',
      header: 'Promocja',
      cell: (r) => (
        <span className="data-table__stack">
          <span className="ana-strong">{r.name}</span>
          <span className="ana-inline">
            <StatusBadge tone={PROMO_TONE[r.status] ?? 'neutral'} compact withDot>
              {r.status === 'manual' ? 'Operator' : promoStatusLabel(r.status)}
            </StatusBadge>
            <span className="muted-text ana-small">{VARIANTS[r.gift].name}</span>
          </span>
        </span>
      ),
    },
    { id: 'given', header: 'Gratisy', align: 'right', cell: (r) => <span className="tabular">{fmt.number(r.given)}</span> },
    { id: 'orders', header: 'Zamówienia', align: 'right', hideBelow: 1024, cell: (r) => <span className="tabular">{fmt.number(r.orders)}</span> },
    { id: 'cost', header: 'Koszt netto', align: 'right', cell: (r) => <CostCell row={r} /> },
    {
      id: 'avg',
      header: 'Średnio na gratis',
      align: 'right',
      hideBelow: 768,
      cell: (r) => (r.cost === null || r.given - r.unknownUnits <= 0 ? <span className="ana-unknown">-</span> : <span className="tabular mono-text">{amt(Math.round(r.cost / (r.given - r.unknownUnits)))}</span>),
    },
    { id: 'budget', header: 'Budżet do wydania', hideBelow: 768, cell: (r) => <BudgetCell row={r} /> },
    { id: 'channels', header: 'Kanały', hideBelow: 1024, cell: (r) => <ChannelSplit channels={r.channels} /> },
  ];
  return (
    <AnaPanel eyebrow="Gratisy" title="Według promocji" testId="ana-gifts-by-promo">
      <WeeklyBars
        weeks={WEEKS}
        values={f.weeklyCost}
        labels={f.weeklyCost.map((v) => (v > 0 ? amt(v) : ''))}
        ariaLabel={`Koszt gratisów tydzień po tygodniu: ${f.weeklyCost.map((v) => amt(v)).join(', ')}`}
      />
      <DataTable
        caption="Koszt gratisów według promocji"
        columns={columns}
        rows={f.rows}
        rowKey={(r) => r.id}
        cardView={{
          title: (r) => r.name,
          subtitle: (r) => `${promoStatusLabel(r.status === 'manual' ? 'Operator' : r.status)} · ${VARIANTS[r.gift].name}`,
          meta: (r) => <CostCell row={r} />,
          summary: (r) => (
            <span className="tabular">
              {fmt.number(r.given)} gratisów · {fmt.number(r.orders)} zamówień
            </span>
          ),
          detail: (r) => <ChannelSplit channels={r.channels} />,
        }}
      />
      <p className="data-table__footnote">
        Razem {fmt.number(f.given)} gratisów w {fmt.number(f.ordersSum)} zamówieniach (unikalnych {fmt.number(f.ordersUnique)}: {OVERLAP_ORDERS} zamówień dostało gratisy z dwóch promocji). Szkic „Świąteczna herbata gratis” jeszcze nic nie wydał.{' '}
        <button type="button" className="button button--ghost ana-link" onClick={() => go('promotions')}>
          Otwórz promocje
        </button>
      </p>
    </AnaPanel>
  );
}

/* ── Per channel ───────────────────────────────────────────────────── */

type ChannelRow = GiftFigures['perChannel'][number];

function ChannelsTable({ f }: { f: GiftFigures }): ReactElement {
  const fmt = useFormat();
  const amt = useAmount();
  const columns: DataTableColumn<ChannelRow>[] = [
    {
      id: 'channel',
      header: 'Kanał sprzedaży',
      cell: (r) => (
        <span className="data-table__stack">
          <span className="ana-inline">
            <span className="ana-dot" style={{ background: `var(${CHANNELS[r.id].colorVar})` }} aria-hidden="true" />
            <span className="ana-strong">{CHANNELS[r.id].name}</span>
          </span>
          <span className="muted-text ana-small">{GIFT_SUPPORT[CHANNELS[r.id].giftSupport]}</span>
        </span>
      ),
    },
    { id: 'given', header: 'Gratisy', align: 'right', cell: (r) => <span className="tabular">{fmt.number(r.given)}</span> },
    { id: 'orders', header: 'Zamówienia', align: 'right', hideBelow: 768, cell: (r) => <span className="tabular">{fmt.number(r.orders)}</span> },
    {
      id: 'cost',
      header: 'Koszt netto',
      align: 'right',
      cell: (r) => (
        <>
          <Amount grosze={r.cost} strong />
          {r.unknownUnits > 0 ? <div className="ana-unknown ana-small">+ {fmt.number(r.unknownUnits)} szt. bez kosztu</div> : null}
        </>
      ),
    },
    { id: 'perOrder', header: 'Na zamówienie', align: 'right', hideBelow: 1024, cell: (r) => <span className="tabular mono-text">{amt(Math.round(r.cost / Math.max(1, r.orders)))}</span> },
    {
      id: 'share',
      header: 'Udział w marży',
      align: 'right',
      hideBelow: 768,
      cell: (r) => (
        <span className="data-table__stack ana-right">
          <span className="tabular">{fmt.percent(r.cost / r.marginBefore)}</span>
          <ShareBar value={(r.cost / r.marginBefore) * 5} tone="gift" />
        </span>
      ),
    },
  ];
  return (
    <AnaPanel eyebrow="Gratisy" title="Według kanału" testId="ana-gifts-by-channel">
      <DataTable
        caption="Koszt gratisów według kanału"
        columns={columns}
        rows={f.perChannel}
        rowKey={(r) => r.id}
        cardView={{
          title: (r) => CHANNELS[r.id].name,
          subtitle: (r) => GIFT_SUPPORT[CHANNELS[r.id].giftSupport],
          meta: (r) => <Amount grosze={r.cost} strong />,
          summary: (r) => (
            <span className="tabular">
              {fmt.number(r.given)} gratisów · udział w marży {fmt.percent(r.cost / r.marginBefore)}
            </span>
          ),
        }}
      />
      <p className="data-table__footnote">
        Na Allegro i Erli gratis istnieje tylko w OpenLinker: OpenLinker dopisuje pozycję gratisu do zamówienia, rezerwuje ją, pakowacz ją skanuje, a stan schodzi w sklepie, który go prowadzi. Klient na kanale nie widzi gratisu na zamówieniu.
      </p>
    </AnaPanel>
  );
}

/* ── Small-gift register (PL country pack) ─────────────────────────── */

function SmallGiftRegister(): ReactElement {
  const money = useMoney();
  const fmt = useFormat();
  const guard = useWriteGuard();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [hashOnly, setHashOnly] = useState(false);
  const units = unitLimitRows();
  const rows = RECIPIENTS.map((r) => ({ r, t: recipientTotals(r) }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: 'who',
      header: 'Odbiorca',
      cell: ({ r }) =>
        hashOnly ? (
          <span className="data-table__stack">
            <span className="mono-text">skrót {r.hash}</span>
            <span className="muted-text ana-small">nazwa niedostępna</span>
          </span>
        ) : (
          <span className="data-table__stack">
            <span className="ana-strong">{r.name}</span>
            <span className="mono-text muted-text ana-small">{r.key} · {CHANNELS[r.channel].name}</span>
          </span>
        ),
    },
    { id: 'count', header: 'Gratisy w 2026', align: 'right', cell: ({ t }) => <span className="tabular">{fmt.number(t.count)}</span> },
    {
      id: 'total',
      header: 'Koszt zakupu netto w roku',
      align: 'right',
      cell: ({ t }) =>
        t.total === null ? (
          <span className="data-table__stack ana-right">
            <span className="ana-unknown">koszt nieznany</span>
            <span className="muted-text ana-small tabular">znany: {money(t.known, 'PLN')}</span>
          </span>
        ) : (
          <span className="data-table__stack ana-right">
            <span className="tabular mono-text ana-strong">{money(t.total, 'PLN')}</span>
            <ShareBar value={t.total / SMALL_GIFT_YEAR_LIMIT} tone={t.status === 'over' ? 'neutral' : 'gift'} />
          </span>
        ),
    },
    {
      id: 'status',
      header: 'Limit 100 zł',
      cell: ({ t }) =>
        t.status === 'unknown' ? (
          <StatusBadge tone="warning" compact withDot>Nie wiadomo</StatusBadge>
        ) : t.status === 'over' ? (
          <StatusBadge tone="error" compact withDot>Przekroczony</StatusBadge>
        ) : (
          <StatusBadge tone="success" compact withDot>Mieści się, zostało {money(SMALL_GIFT_YEAR_LIMIT - (t.total ?? 0), 'PLN')}</StatusBadge>
        ),
    },
    {
      id: 'priced',
      header: 'Pominięte',
      hideBelow: 1024,
      cell: ({ t }) => (t.pricedIn > 0 ? <span className="muted-text ana-small">{t.pricedIn} gratis w cenie zestawu (sprzedaż odpłatna)</span> : <span className="muted-text">-</span>),
    },
  ];
  return (
    <AnaPanel
      eyebrow="Pakiet krajowy: Polska"
      title="Rejestr małych prezentów"
      testId="ana-small-gift-register"
      actions={
        <Button tone="secondary" onClick={() => showToast({ tone: 'success', description: 'Wyeksportowano rejestr małych prezentów (CSV).' })}>
          Eksportuj rejestr
        </Button>
      }
    >
      <div className="ana-stack-sm">
        <Switch
          checked={enabled}
          disabled={!guard.canWrite}
          hint={guard.reason}
          onChange={(v) => {
            setEnabled(v);
            showToast({ tone: 'success', description: v ? 'Włączono rejestr małych prezentów.' : 'Wyłączono rejestr małych prezentów.' });
          }}
          label="Prowadź rejestr małych prezentów (pakiet PL)"
        />
        <Note>
          Dotyczy tylko gratisów przekazanych nieodpłatnie i zapisanych poza dokumentem kupującego. Gratis wliczony w cenę zestawu to sprzedaż odpłatna i nie trafia do rejestru. Progi: koszt zakupu do {money(SMALL_GIFT_UNIT_LIMIT, 'PLN')} netto za sztukę bez rejestru albo do {money(SMALL_GIFT_YEAR_LIMIT, 'PLN')} netto na osobę w roku z rejestrem. To podgląd danych, nie porada podatkowa.
        </Note>
      </div>
      {!enabled ? (
        <Alert tone="info" density="compact" title="Rejestr jest wyłączony">
          OpenLinker nadal zapisuje każdy gratis z kosztem i odbiorcą, ale nie liczy limitów. Włącz rejestr, żeby zobaczyć sumy roczne.
        </Alert>
      ) : (
        <>
          <Alert tone="warning" density="compact" title="Rejestr wymaga danych kupującego">
            Limit 100 zł liczy się na osobę, więc OpenLinker musi wiedzieć, kim jest odbiorca. Na Allegro adres e-mail jest inny przy każdym zamówieniu, dlatego kluczem jest rozpoznany klient, a nie e-mail. Jeśli przechowujesz tylko skróty danych osobowych, rejestr imienny się z tym kłóci i trzeba o tym zdecydować.
          </Alert>
          <Switch checked={hashOnly} onChange={setHashOnly} label="Pokaż, jak wygląda rejestr przy przechowywaniu tylko skrótów" />
          <DataTable
            caption="Roczne sumy kosztu gratisów na odbiorcę"
            columns={columns}
            rows={rows}
            rowKey={({ r }) => r.key}
            cardView={{
              title: ({ r }) => (hashOnly ? `skrót ${r.hash}` : r.name),
              subtitle: ({ r, t }) => `${CHANNELS[r.channel].name} · ${t.count} gratisów`,
              meta: ({ t }) => (t.total === null ? <span className="ana-unknown">koszt nieznany</span> : <span className="tabular">{money(t.total, 'PLN')}</span>),
              summary: ({ t }) => (t.status === 'over' ? 'Przekroczony limit 100 zł' : t.status === 'unknown' ? 'Nie wiadomo, czy mieści się w limicie' : 'Mieści się w limicie 100 zł'),
            }}
          />
          {hashOnly ? (
            <p className="data-table__footnote">Sumy nadal się liczą, bo skrót jest stały dla klienta. Nie da się jednak pokazać urzędowi, komu przekazano prezent. To trzeba rozstrzygnąć przed włączeniem rejestru.</p>
          ) : null}
          <h4 className="section-title analytics-margin__subtitle">Koszt zakupu sztuki a próg 20 zł</h4>
          <div className="data-table__container" tabIndex={0} role="region" aria-label="Koszt sztuki gratisu (przewijana tabela)">
            <table className="data-table">
              <caption className="sr-only">Koszt zakupu sztuki gratisu względem progu 20 zł</caption>
              <thead>
                <tr>
                  <th>Gratis</th>
                  <th className="analytics-margin__num">Koszt sztuki netto</th>
                  <th>Bez rejestru</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.variant}>
                    <td>
                      <span className="ana-inline">
                        <GiftMark compact /> {VARIANTS[u.variant].name}
                      </span>
                    </td>
                    <td className="analytics-margin__num tabular">{u.cost === null ? <span className="ana-unknown">koszt nieznany</span> : money(u.cost, 'PLN')}</td>
                    <td>
                      {u.ok === null ? (
                        <StatusBadge tone="warning" compact withDot>Nie wiadomo, uzupełnij koszt</StatusBadge>
                      ) : u.ok ? (
                        <StatusBadge tone="success" compact withDot>Do 20 zł</StatusBadge>
                      ) : (
                        <StatusBadge tone="error" compact withDot>Powyżej 20 zł, potrzebny rejestr</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AnaPanel>
  );
}

