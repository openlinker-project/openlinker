/**
 * Koszt gratisów, wersja prosta: one report instead of three tabs. Gifts by
 * promotion with "kosztowało Cię X", bundles and component demand as a view of
 * the same report, stock movements as a filter. CSV export per customer for the
 * accountant replaces the small-gift register.
 */
import { useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { Select } from '@web/shared/ui/select';
import { FormField } from '@web/shared/ui/form-field';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { EmptyState } from '@web/shared/ui/feedback-state';
import { useToast } from '@web/shared/ui/toast-provider';
import { useFormat } from '@web/shared/i18n/use-format';
import { CHANNELS, VARIANTS, type ChannelId } from '../model/catalog';
import { commonStates, type ScreenDef, type StateDef } from '../proto';
import { GiftMark } from '../ui/marks';
import { AggregateWhoPays, AnaToolbar, Amount } from './ana-shared';
import { MOVEMENTS, PERIOD, bundleFigures, bundleSales, componentDemand, giftFigures, promoStatusLabel, type BundleFigures, type GiftRow, type Movement } from './ana-data';
import './ana.css';
import './v1-misc.css';

type View = 'gifts' | 'bundles' | 'movements';
type Source = 'all' | 'promotion' | 'operator';
type MoveFilter = 'gift' | 'bundle-component';

interface Seed {
  view: View;
  gaps: boolean;
  empty?: boolean;
  exportOpen?: boolean;
  channel?: ChannelId | 'all';
  move?: MoveFilter;
}

const SEEDS: Record<string, Seed> = {
  gifts: { view: 'gifts', gaps: false },
  'gifts-cost-unknown': { view: 'gifts', gaps: true },
  'gifts-channel': { view: 'gifts', gaps: false, channel: 'allegro' },
  'gifts-export': { view: 'gifts', gaps: false, exportOpen: true },
  'gifts-none': { view: 'gifts', gaps: false, empty: true },
  bundles: { view: 'bundles', gaps: false },
  'bundles-no-cost': { view: 'bundles', gaps: true },
  'movements-gift': { view: 'movements', gaps: false, move: 'gift' },
  'movements-bundle': { view: 'movements', gaps: false, move: 'bundle-component' },
};

function GiftsView({ gaps, channel, source, empty }: { gaps: boolean; channel: ChannelId | 'all'; source: Source; empty?: boolean }): ReactElement {
  const fmt = useFormat();
  const f = giftFigures(gaps);
  const rows = f.rows.filter((r) => (source === 'all' || r.source === source) && (channel === 'all' || (r.channels[channel] ?? 0) > 0));
  if (empty || rows.length === 0) {
    return <EmptyState title="Nie wydano jeszcze żadnego gratisu" message="Koszt pojawi się tu, gdy promocja doda gratis do zamówienia albo dodasz go ręcznie. OpenLinker liczy koszt po cenie zakupu z dnia wydania." />;
  }
  const units = rows.reduce((a, r) => a + (channel === 'all' ? r.given : (r.channels[channel] ?? 0)), 0);
  const cost = rows.reduce((a, r) => {
    const c = VARIANTS[r.gift].cost;
    if (channel === 'all') return a + (r.cost ?? 0);
    return a + (c === null ? 0 : (r.channels[channel] ?? 0) * c);
  }, 0);
  const unknown = rows.reduce((a, r) => a + r.unknownUnits, 0);
  const columns: DataTableColumn<GiftRow>[] = [
    {
      id: 'name',
      header: 'Promocja',
      cell: (r) => (
        <span className="data-table__stack">
          <span className="ana-strong">{r.name}</span>
          <span className="muted-text">{r.source === 'operator' ? 'Dodane ręcznie' : promoStatusLabel(r.status)}</span>
        </span>
      ),
    },
    { id: 'gift', header: 'Gratis', cell: (r) => <span className="v1-row-mark"><GiftMark compact /> {VARIANTS[r.gift].name}</span>, hideBelow: 768 },
    { id: 'units', header: 'Sztuki', align: 'right', cell: (r) => <span className="tabular">{fmt.number(channel === 'all' ? r.given : (r.channels[channel] ?? 0))}</span> },
    { id: 'orders', header: 'Zamówienia', align: 'right', cell: (r) => <span className="tabular">{fmt.number(r.orders)}</span>, hideBelow: 768 },
    {
      id: 'cost',
      header: 'Kosztowało Cię',
      align: 'right',
      cell: (r) =>
        r.cost === null ? (
          <StatusBadge tone="warning" compact>Koszt nieznany</StatusBadge>
        ) : (
          <span className="data-table__stack">
            <Amount grosze={channel === 'all' ? r.cost : (VARIANTS[r.gift].cost ?? 0) * (r.channels[channel] ?? 0)} strong />
            {r.unknownUnits > 0 ? <span className="muted-text">bez {fmt.number(r.unknownUnits)} szt.</span> : null}
          </span>
        ),
    },
  ];
  return (
    <div className="cfg-stack">
      <AggregateWhoPays units={units} cost={cost} unknownUnits={channel === 'all' ? unknown : 0} />
      {gaps && channel === 'all' ? (
        <Alert tone="warning" density="compact" title={`${fmt.number(unknown)} szt. gratisów bez kosztu zakupu`}>
          Nie są w koszcie powyżej. Uzupełnij koszt zakupu wariantu (próbka kawy, młynek z Subiekta), a raport przeliczy się sam.
        </Alert>
      ) : null}
      <DataTable
        caption="Koszt gratisów według promocji"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        cardView={{
          title: (r) => r.name,
          subtitle: (r) => VARIANTS[r.gift].name,
          summary: (r) => <span className="tabular">{fmt.number(r.given)} szt. · {fmt.number(r.orders)} zamówień</span>,
        }}
      />
    </div>
  );
}

function BundlesView({ gaps }: { gaps: boolean }): ReactElement {
  const fmt = useFormat();
  const figures = bundleSales(gaps).map(bundleFigures);
  const demand = componentDemand(bundleSales(gaps));
  const columns: DataTableColumn<BundleFigures>[] = [
    { id: 'name', header: 'Zestaw', cell: (b) => <span className="data-table__stack"><span className="ana-strong">{b.sale.name}</span><span className="muted-text">{b.sale.sku}</span></span> },
    { id: 'units', header: 'Sprzedane', align: 'right', cell: (b) => <span className="tabular">{fmt.number(b.sale.units)} szt.</span> },
    { id: 'net', header: 'Przychód netto', align: 'right', cell: (b) => <Amount grosze={b.net} />, hideBelow: 768 },
    { id: 'margin', header: 'Marża', align: 'right', cell: (b) => (b.margin === null ? <StatusBadge tone="warning" compact>Brak kosztu składnika</StatusBadge> : <Amount grosze={b.margin} strong />) },
  ];
  return (
    <div className="cfg-stack">
      <p className="v1-auto">Koszt zestawu to suma kosztów zakupu składników. Gratis w zestawie liczy się jako koszt.</p>
      <DataTable caption="Sprzedaż zestawów" columns={columns} rows={figures} rowKey={(b) => b.sale.id} cardView={{ title: (b) => b.sale.name, summary: (b) => <span className="tabular">{fmt.number(b.sale.units)} szt.</span> }} />
      <DataTable
        caption="Popyt na składniki"
        columns={[
          { id: 'v', header: 'Składnik', cell: (d) => VARIANTS[d.variant].name },
          { id: 'b', header: 'W zestawach', align: 'right', cell: (d) => <span className="tabular">{fmt.number(d.viaBundles)}</span> },
          { id: 'a', header: 'Osobno', align: 'right', cell: (d) => <span className="tabular">{fmt.number(d.alone)}</span>, hideBelow: 768 },
          { id: 's', header: 'Dostępne', align: 'right', cell: (d) => <span className="tabular">{fmt.number(d.available)}</span> },
        ]}
        rows={demand}
        rowKey={(d) => d.variant}
        cardView={{ title: (d) => VARIANTS[d.variant].name, summary: (d) => <span className="tabular">{fmt.number(d.viaBundles)} w zestawach · {fmt.number(d.available)} dostępne</span> }}
      />
    </div>
  );
}

function MovementsView({ filter }: { filter: MoveFilter }): ReactElement {
  const fmt = useFormat();
  const rows = MOVEMENTS.filter((m) => (filter === 'gift' ? m.type === 'gift' || m.giftSlot || (m.type === 'manual' && /gratis/i.test(m.reason ?? '')) : m.type === 'bundle-component'));
  const columns: DataTableColumn<Movement>[] = [
    { id: 'at', header: 'Kiedy', cell: (m) => <span className="tabular">{fmt.date(m.at)}</span>, hideBelow: 768 },
    { id: 'v', header: 'Produkt', cell: (m) => <span className="data-table__stack"><span>{m.label ?? VARIANTS[m.variant].name}</span><span className="muted-text">{m.reason}</span></span> },
    { id: 'o', header: 'Zamówienie', cell: (m) => m.order?.ref ?? (m.actor ? `ręcznie: ${m.actor}` : '-'), hideBelow: 768 },
    {
      id: 'd',
      header: 'Zmiana',
      align: 'right',
      cell: (m) =>
        m.status === 'refused' ? (
          <span className="data-table__stack">
            <StatusBadge tone="error" compact>Nie zdjęto</StatusBadge>
            <span className="muted-text v1-wrap">{m.refusal}</span>
          </span>
        ) : (
          <span className="tabular">{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
        ),
    },
  ];
  return <DataTable caption="Ruchy magazynu" columns={columns} rows={rows} rowKey={(m) => m.id} cardView={{ title: (m) => m.label ?? VARIANTS[m.variant].name, summary: (m) => <span className="tabular">{m.delta} · {m.order?.ref ?? '-'}</span> }} />;
}

function ReportV1({ stateId }: { stateId: string }): ReactElement {
  const seed = SEEDS[stateId] ?? SEEDS.gifts;
  const { showToast } = useToast();
  const [view, setView] = useState<View>(seed.view);
  const [channel, setChannel] = useState<ChannelId | 'all'>(seed.channel ?? 'all');
  const [source, setSource] = useState<Source>('all');
  const [move, setMove] = useState<MoveFilter>(seed.move ?? 'gift');
  const [exportOpen, setExportOpen] = useState(Boolean(seed.exportOpen));
  return (
    <PageLayout
      title="Koszt gratisów"
      description="Ile gratisów wydałeś, ile kosztowały i jak sprzedają się zestawy. Jeden raport, filtry na górze."
      actions={
        <Button tone="secondary" onClick={() => setExportOpen((o) => !o)}>
          Eksport per klient (CSV)
        </Button>
      }
    >
      <div className="ana-scope cfg-stack">
        <AnaToolbar from={PERIOD.from} to={PERIOD.to} />
        {exportOpen ? (
          <Alert
            tone="info"
            title="Roczny eksport gratisów dla księgowej"
            action={
              <Button onClick={() => { showToast({ tone: 'success', title: 'Wyeksportowano', description: 'Gratisy 2026 per klient (CSV): 1 214 wierszy.' }); setExportOpen(false); }}>
                Pobierz CSV za 2026
              </Button>
            }
          >
            Każdy wiersz: data, klient, gratis, koszt zakupu netto, dokument. Klient to ten sam kupujący we wszystkich zamówieniach, nawet gdy Allegro podaje za każdym razem inny e-mail. Progi 20 zł i 100 zł rocznie ocenia księgowa, OpenLinker ich nie pilnuje.
          </Alert>
        ) : null}
        <div className="v1-filters">
          <SegmentedControl
            aria-label="Widok raportu"
            options={[
              { value: 'gifts', label: 'Gratisy' },
              { value: 'bundles', label: 'Zestawy' },
              { value: 'movements', label: 'Ruchy magazynu' },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
          {view === 'gifts' ? (
            <>
              <FormField label="Kanał" name="channel">
                <Select value={channel} onChange={(e) => setChannel(e.target.value as ChannelId | 'all')}>
                  <option value="all">Wszystkie kanały</option>
                  {(['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'] as ChannelId[]).map((c) => (
                    <option key={c} value={c}>{CHANNELS[c].name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Skąd gratis" name="source">
                <Select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                  <option value="all">Wszystkie</option>
                  <option value="promotion">Z promocji</option>
                  <option value="operator">Dodane ręcznie</option>
                </Select>
              </FormField>
            </>
          ) : null}
          {view === 'movements' ? (
            <FormField label="Pokaż" name="move">
              <Select value={move} onChange={(e) => setMove(e.target.value as MoveFilter)}>
                <option value="gift">Gratisy</option>
                <option value="bundle-component">Składniki zestawów</option>
              </Select>
            </FormField>
          ) : null}
        </div>
        {view === 'gifts' ? <GiftsView gaps={seed.gaps} channel={channel} source={source} empty={seed.empty} /> : null}
        {view === 'bundles' ? <BundlesView gaps={seed.gaps} /> : null}
        {view === 'movements' ? <MovementsView filter={move} /> : null}
      </div>
    </PageLayout>
  );
}

const STATES: StateDef[] = [
  { id: 'gifts', label: 'Gratisy', note: 'Jeden raport: pasek "Klienci zapłacili 0 zł, kosztowały Cię X" i tabela promocji z kosztem. Decyzja: BaseLinker i Apilo nie mają raportu gratisów wcale, więc v1 to jedna tabela, bez zakładek i bez KPI marży (te przyjdą z kosztami, #3588).', useCases: ['G-12', 'G-06', 'X-01'], priority: 'pilot' },
  { id: 'gifts-cost-unknown', label: 'Koszt nieznany', note: 'Próbki i młynek z Subiekta nie mają kosztu zakupu. Raport mówi, ile sztuk pominął, i nie zgaduje kosztu.', useCases: ['G-12', 'G-05', 'B-16'], priority: 'pilot' },
  { id: 'gifts-channel', label: 'Filtr kanału', note: 'Zamiast osobnej zakładki "według kanału" jest filtr. Pokazuje gratisy z OL na Allegro, gdzie kanał nie zna gratisów.', useCases: ['G-12', 'G-01', 'G-02', 'G-03'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gifts-export', label: 'Eksport per klient', note: 'Roczny CSV dla księgowej zamiast rejestru z limitami. Kluczem jest rozpoznany klient, nie e-mail. Decyzja: żadne narzędzie na rynku nie prowadzi tej ewidencji samo, wystarczy eksport.', useCases: ['G-12', 'G-19', 'D-07'], priority: 'later' },
  { id: 'gifts-none', label: 'Brak gratisów', note: 'Nikt jeszcze nie dostał gratisu. Pusty raport mówi, kiedy pojawią się dane.', useCases: ['G-12'], priority: 'pilot' },
  { id: 'bundles', label: 'Zestawy', note: 'Ten sam raport, widok "Zestawy": sprzedaż, marża (koszt = suma składników) i popyt na składniki pod spodem.', useCases: ['B-16', 'B-10', 'B-14', 'B-23', 'B-02'], priority: 'later' },
  { id: 'bundles-no-cost', label: 'Zestaw bez kosztu składnika', note: 'Młynek nie ma kosztu, więc marży zestawu nie da się policzyć. Raport mówi to w wierszu, nie liczy zera.', useCases: ['B-16'], priority: 'later' },
  { id: 'movements-gift', label: 'Ruchy: gratisy', note: 'Filtr ruchów magazynu: każdy gratis, który zszedł ze stanu, z zamówieniem albo z ręczną korektą trybu pilota.', useCases: ['G-04', 'G-20', 'G-06'], priority: 'pilot' },
  { id: 'movements-bundle', label: 'Ruchy: składniki zestawów', note: 'Stan zszedł ze składników, nie z zestawu. Wiersz odrzucony mówi po ludzku, czemu sklep nie pozwolił zdjąć stanu. Pod spodem: zdejmowanie stanu robi integracja magazynu (PrestaShop, Subiekt).', useCases: ['B-23', 'B-11', 'B-20', 'B-22'], priority: 'pilot' },
  ...commonStates('raportu', 'utwórz pierwszą promocję z gratisem'),
];

export const screen: ScreenDef = {
  id: 'report',
  group: 'Analityka',
  label: 'Koszt gratisów',
  states: STATES,
  render: (state) => <ReportV1 key={state} stateId={state} />,
};
