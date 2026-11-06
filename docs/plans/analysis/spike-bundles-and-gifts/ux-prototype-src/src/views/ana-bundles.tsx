/**
 * "Zestawy" tab: revenue and margin per bundle with cost = sum of component costs,
 * the bundle without a cost, attach rate, and component demand from bundles.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { AnalyticsKpiCard } from '@web/features/analytics/components/analytics-kpi-card';
import { GapMark } from '@web/features/analytics/components/gap-mark';
import { Alert } from '@web/shared/ui/alert';
import { Button } from '@web/shared/ui/button';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web/shared/ui/dialog';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { useToast } from '@web/shared/ui/toast-provider';
import { useFormat } from '@web/shared/i18n/use-format';
import { CHANNELS, MASTERS, VARIANTS, type ChannelId } from '../model/catalog';
import { useMoney, useProto, useWriteGuard } from '../proto';
import { BundleMark, GiftMark } from '../ui/marks';
import { Amount, AnaPanel, BasisNote, ShareBar, WeeklyBars, useAmount } from './ana-shared';
import { ALL_ORDERS, BUNDLE_OVERLAP_ORDERS, BUNDLE_WEEK_WEIGHTS, bundleFigures, bundleSales, componentDemand, GRINDER_SET, WEEKS, type BundleFigures } from './ana-data';

export type BundlesMode = 'margin' | 'no-cost' | 'component-demand';

export function BundlesTab({ mode }: { mode: BundlesMode }): ReactElement {
  const withNoCost = mode === 'no-cost';
  const figures = useMemo(() => bundleSales(withNoCost).map(bundleFigures), [withNoCost]);
  const [view, setView] = useState<'margin' | 'demand'>(mode === 'component-demand' ? 'demand' : 'margin');
  return (
    <div className="ana-stack">
      <BasisNote>Koszt zestawu to suma kosztów zakupu składników z dnia sprzedaży razy ich ilość w zestawie. Przychód netto dzielony na składniki proporcjonalnie do cen pojedynczych, po stawce VAT każdego składnika.</BasisNote>
      <BundleKpis figures={figures} />
      {withNoCost ? <NoCostAlert /> : null}
      <div className="toolbar ana-subbar">
        <div className="toolbar__group">
          <SegmentedControl
            aria-label="Widok zestawów"
            options={[
              { value: 'margin', label: 'Marża i przychód' },
              { value: 'demand', label: 'Popyt na składniki' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>
      {view === 'margin' ? (
        <>
          <BundleMarginTable figures={figures} highlightNoCost={withNoCost} />
          <AttachRateTable figures={figures} />
        </>
      ) : (
        <ComponentDemandTable figures={figures} />
      )}
    </div>
  );
}

function sumKnown(figures: BundleFigures[]): { net: number; cost: number; margin: number; units: number; unknownUnits: number; orders: number } {
  let net = 0;
  let cost = 0;
  let margin = 0;
  let units = 0;
  let unknownUnits = 0;
  let orders = 0;
  for (const b of figures) {
    units += b.sale.units;
    orders += b.orders;
    if (b.cost === null || b.margin === null) {
      unknownUnits += b.sale.units;
      continue;
    }
    net += b.net;
    cost += b.cost;
    margin += b.margin;
  }
  return { net, cost, margin, units, unknownUnits, orders };
}

function BundleKpis({ figures }: { figures: BundleFigures[] }): ReactElement {
  const fmt = useFormat();
  const amt = useAmount();
  const k = sumKnown(figures);
  const allNet = figures.reduce((a, b) => a + b.net, 0);
  const allOrders = Object.values(ALL_ORDERS).reduce((a, b) => a + (b ?? 0), 0);
  const withBundle = k.orders - BUNDLE_OVERLAP_ORDERS;
  const basis = 'vs 35 dni wcześniej';
  const gap = k.unknownUnits > 0 ? `${k.unknownUnits} szt. zestawu bez kosztu, poza marżą` : null;
  return (
    <section className="status-strip status-strip--analytics" aria-label="Najważniejsze liczby zestawów">
      <AnalyticsKpiCard
        label="Przychód z zestawów"
        infotipLabel="Przychód z zestawów"
        definitions={[{ term: 'Przychód z zestawów', text: 'Przychód netto z pozycji zestawów w zamówieniach z okresu, bez VAT. Gratis w zestawie ma przychód 0.' }]}
        metric="netto, bez VAT"
        value={amt(allNet)}
        trend={{ values: BUNDLE_WEEK_WEIGHTS.map((w) => Math.round(allNet * w)), tone: 'success', ariaLabel: 'Przychód z zestawów tydzień po tygodniu' }}
        delta={{ formatted: '12,4%', tone: 'success', direction: 'up', basisLabel: basis, spokenText: 'Wzrost o 12,4 procent względem 35 dni wcześniej' }}
        qualifiers={[{ label: 'Sprzedane zestawy', value: <span className="tabular">{fmt.number(k.units)}</span> }]}
      />
      <AnalyticsKpiCard
        label="Marża zestawów"
        infotipLabel="Marża zestawów"
        definitions={[{ term: 'Marża zestawu', text: 'Przychód netto minus koszt zestawu. Koszt to suma kosztów zakupu składników razy ilość, łącznie z gratisem w zestawie.', formula: 'przychód netto - Σ koszt składnika x ilość' }]}
        metric={gap ? <>bez zestawów o nieznanym koszcie <GapMark title={gap} /></> : 'przychód netto minus koszt składników'}
        value={amt(k.margin)}
        valueSuffix={k.net > 0 ? fmt.percent(k.margin / k.net) : undefined}
        delta={{ formatted: '1,2 pp', tone: 'error', direction: 'down', basisLabel: basis, spokenText: 'Spadek marży o 1,2 punktu procentowego względem 35 dni wcześniej' }}
        qualifiers={[{ label: 'Koszt składników', value: <span className="tabular">{amt(k.cost)}</span> }]}
      />
      <AnalyticsKpiCard
        label="Zamówienia z zestawem"
        infotipLabel="Udział zamówień z zestawem"
        definitions={[{ term: 'Udział zamówień z zestawem', text: `Zamówienia z co najmniej jednym zestawem podzielone przez wszystkie zamówienia z okresu. Zamówienie z dwoma różnymi zestawami (${BUNDLE_OVERLAP_ORDERS} takie) liczy się raz.`, formula: 'zamówienia z zestawem / wszystkie zamówienia' }]}
        metric={`${fmt.number(withBundle)} z ${fmt.number(allOrders)} zamówień`}
        value={fmt.percent(withBundle / allOrders)}
        delta={{ formatted: '0,9 pp', tone: 'success', direction: 'up', basisLabel: basis, spokenText: 'Wzrost o 0,9 punktu procentowego względem 35 dni wcześniej' }}
      />
    </section>
  );
}

function NoCostAlert(): ReactElement {
  const money = useMoney();
  return (
    <Alert tone="warning" title={`${GRINDER_SET.name} nie ma kosztu`}>
      Składnik {VARIANTS.grinder.name} nie ma kosztu zakupu w {MASTERS.subiekt.name}, więc OpenLinker nie umie policzyć sumy. {GRINDER_SET.units} sprzedanych zestawów ({money(GRINDER_SET.price * GRINDER_SET.units, 'PLN')} brutto) jest poza marżą. Zamówienie przyjęte bez kosztu zostaje bez kosztu, dlatego uzupełnij koszt przed kolejną sprzedażą.
    </Alert>
  );
}

function CostBreakdown({ b }: { b: BundleFigures }): ReactElement {
  const money = useMoney();
  return (
    <span className="ana-components">
      {b.sale.components.map((c) => {
        const v = VARIANTS[c.variant];
        return (
          <span key={c.variant} className="ana-components__item">
            {c.gift ? <GiftMark compact /> : null}
            {c.qty > 1 ? `${c.qty} x ` : ''}
            {v.name.split(',')[0]}{' '}
            <span className="tabular">{v.cost === null ? <span className="ana-unknown">brak kosztu</span> : money(v.cost * c.qty, 'PLN')}</span>
          </span>
        );
      })}
    </span>
  );
}

function BundleMarginTable({ figures, highlightNoCost }: { figures: BundleFigures[]; highlightNoCost: boolean }): ReactElement {
  const fmt = useFormat();
  const amt = useAmount();
  const guard = useWriteGuard();
  const { showToast } = useToast();
  const { go } = useProto();
  const [dialog, setDialog] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const k = sumKnown(figures);

  const columns: DataTableColumn<BundleFigures>[] = [
    {
      id: 'bundle',
      header: 'Zestaw',
      cell: (b) => (
        <span className="data-table__stack">
          <span className="ana-inline">
            <BundleMark compact />
            <span className="ana-strong">{b.sale.name}</span>
            {b.sale.version ? <span className="muted-text ana-small">v{b.sale.version}</span> : null}
          </span>
          <CostBreakdown b={b} />
        </span>
      ),
    },
    { id: 'units', header: 'Sprzedane', align: 'right', cell: (b) => <span className="tabular">{fmt.number(b.sale.units)}</span> },
    { id: 'net', header: 'Przychód netto', align: 'right', hideBelow: 1024, cell: (b) => <Amount grosze={b.net} /> },
    {
      id: 'cost',
      header: 'Koszt (suma składników)',
      align: 'right',
      cell: (b) =>
        b.cost === null ? (
          <span className="data-table__stack ana-right">
            <span className="ana-unknown">koszt nieznany</span>
            {saved !== null && b.sale.extra ? (
              <span className="muted-text ana-small">nowe zamówienia: {amt(saved)} / zestaw</span>
            ) : (
              <Button tone="secondary" disabled={!guard.canWrite} title={guard.reason} onClick={() => setDialog(true)}>
                Wpisz koszt zestawu
              </Button>
            )}
          </span>
        ) : (
          <span className="data-table__stack ana-right">
            <Amount grosze={b.cost} />
            <span className="muted-text ana-small tabular">{amt(b.unitCost)} / zestaw</span>
            {b.giftSlotCost > 0 ? <span className="muted-text ana-small">w tym gratis {amt(b.giftSlotCost)}</span> : null}
          </span>
        ),
    },
    {
      id: 'margin',
      header: 'Marża',
      align: 'right',
      cell: (b) =>
        b.margin === null ? (
          <span className="ana-unknown">-</span>
        ) : (
          <span className="data-table__stack ana-right">
            <Amount grosze={b.margin} strong />
            <span className="muted-text ana-small tabular">{fmt.percent(b.margin / b.net)}</span>
          </span>
        ),
    },
  ];

  const weekly = BUNDLE_WEEK_WEIGHTS.map((w) => Math.round(k.margin * w));
  const pct = [0.402, 0.398, 0.395, 0.391, 0.378, 0.384];

  return (
    <AnaPanel eyebrow="Rentowność" title="Marża zestawów" testId="ana-bundle-margin">
      <WeeklyBars weeks={WEEKS} values={weekly} labels={pct.map((p) => fmt.percent(p))} ariaLabel={`Marża zestawów tydzień po tygodniu: ${weekly.map((v) => amt(v)).join(', ')}`} />
      <DataTable
        caption="Przychód i marża według zestawu"
        columns={columns}
        rows={figures}
        rowKey={(b) => b.sale.id}
        rowClassName={(b) => (highlightNoCost && b.cost === null ? 'ana-row--attention' : undefined)}
        cardView={{
          title: (b) => `${b.sale.name}${b.sale.version ? ` v${b.sale.version}` : ''}`,
          subtitle: (b) => `${fmt.number(b.sale.units)} sprzedanych`,
          meta: (b) => (b.margin === null ? <span className="ana-unknown">koszt nieznany</span> : <Amount grosze={b.margin} strong />),
          summary: (b) => <CostBreakdown b={b} />,
          actions: (b) =>
            b.cost === null && saved === null ? (
              <Button tone="secondary" disabled={!guard.canWrite} title={guard.reason} onClick={() => setDialog(true)}>
                Wpisz koszt zestawu
              </Button>
            ) : null,
        }}
      />
      <p className="data-table__footnote">
        Razem {fmt.number(k.units)} zestawów. Wersje zestawu liczą się osobno, bo mają inne składniki: v2 Zestawu porannego zawiera łyżeczkę jako gratis, której koszt obniża marżę. Dokument sprzedaży nadal ma jedną pozycję zestawu, podział na składniki służy tylko analizie.
      </p>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogTitle>Wpisz koszt zestawu</DialogTitle>
          <DialogDescription>
            {GRINDER_SET.name}. Do czasu uzupełnienia kosztu młynka możesz wpisać koszt całego zestawu na jego wariancie. Gdy wszystkie składniki będą miały koszt, OpenLinker zaproponuje ich sumę.
          </DialogDescription>
          <FormField name="ana-bundle-cost" label="Koszt zakupu zestawu netto (zł)" description={`Zamówienia już przyjęte (${GRINDER_SET.units}) zostaną bez kosztu.`}>
            <Input inputMode="decimal" placeholder="np. 92,50" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </FormField>
          <DialogFooter>
            <Button tone="ghost" onClick={() => go('catalog')}>
              Uzupełnij koszt młynka
            </Button>
            <Button tone="secondary" onClick={() => setDialog(false)}>
              Anuluj
            </Button>
            <Button
              disabled={!guard.canWrite || !/^\d+([.,]\d{1,2})?$/.test(draft.trim())}
              title={guard.reason}
              onClick={() => {
                setSaved(Math.round(Number(draft.trim().replace(',', '.')) * 100));
                setDialog(false);
                showToast({ tone: 'success', description: 'Zapisano koszt zestawu. Nowe zamówienia dostaną ten koszt.' });
              }}
            >
              Zapisz koszt zestawu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnaPanel>
  );
}

function AttachRateTable({ figures }: { figures: BundleFigures[] }): ReactElement {
  const fmt = useFormat();
  const rows = (Object.keys(ALL_ORDERS) as ChannelId[]).map((id) => {
    const withBundle = figures.reduce((a, b) => a + (b.sale.orders[id] ?? 0), 0);
    const all = ALL_ORDERS[id] ?? 0;
    return { id, all, withBundle, rate: all ? withBundle / all : 0 };
  });
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: 'channel',
      header: 'Kanał sprzedaży',
      cell: (r) => (
        <span className="ana-inline">
          <span className="ana-dot" style={{ background: `var(${CHANNELS[r.id].colorVar})` }} aria-hidden="true" />
          {CHANNELS[r.id].name}
        </span>
      ),
    },
    { id: 'all', header: 'Wszystkie zamówienia', align: 'right', hideBelow: 768, cell: (r) => <span className="tabular">{fmt.number(r.all)}</span> },
    { id: 'with', header: 'Z zestawem', align: 'right', cell: (r) => <span className="tabular">{fmt.number(r.withBundle)}</span> },
    {
      id: 'rate',
      header: 'Udział',
      align: 'right',
      cell: (r) => (
        <span className="data-table__stack ana-right">
          <span className="tabular">{fmt.percent(r.rate)}</span>
          <ShareBar value={r.rate * 4} tone="bundle" />
        </span>
      ),
    },
  ];
  return (
    <AnaPanel eyebrow="Sprzedaż" title="Zamówienia z zestawem według kanału">
      <DataTable caption="Udział zamówień z zestawem według kanału" columns={columns} rows={rows} rowKey={(r) => r.id} />
      <p className="data-table__footnote">WooCommerce i Shoper nie sprzedają tych zestawów jako osobnych ofert poza Zestawem do parzenia. Erli zna zestaw tylko po SKU.</p>
    </AnaPanel>
  );
}

function ComponentDemandTable({ figures }: { figures: BundleFigures[] }): ReactElement {
  const fmt = useFormat();
  const rows = componentDemand(figures.map((f) => f.sale));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: 'variant',
      header: 'Składnik',
      cell: (r) => (
        <span className="data-table__stack">
          <span className="ana-strong">{VARIANTS[r.variant].name}</span>
          <span className="mono-text muted-text ana-small">{VARIANTS[r.variant].sku} · {MASTERS[VARIANTS[r.variant].master].name}</span>
        </span>
      ),
    },
    {
      id: 'via',
      header: 'Z zestawów',
      align: 'right',
      cell: (r) => (
        <span className="data-table__stack ana-right">
          <span className="tabular">{fmt.number(r.viaBundles)}</span>
          {r.asGiftSlot > 0 ? <span className="muted-text ana-small">w tym {fmt.number(r.asGiftSlot)} jako gratis</span> : null}
        </span>
      ),
    },
    { id: 'alone', header: 'Sprzedane osobno', align: 'right', cell: (r) => <span className="tabular">{fmt.number(r.alone)}</span> },
    {
      id: 'share',
      header: 'Udział zestawów',
      align: 'right',
      hideBelow: 768,
      cell: (r) => {
        const s = r.viaBundles / Math.max(1, r.viaBundles + r.alone);
        return (
          <span className="data-table__stack ana-right">
            <span className="tabular">{fmt.percent(s)}</span>
            <ShareBar value={s} tone="bundle" />
          </span>
        );
      },
    },
    {
      id: 'avail',
      header: 'Dostępne teraz',
      align: 'right',
      hideBelow: 1024,
      cell: (r) => <span className={`tabular${r.available <= 2 ? ' ana-unknown' : ''}`}>{fmt.number(r.available)}</span>,
    },
  ];
  return (
    <AnaPanel eyebrow="Magazyn" title="Popyt na składniki z zestawów" testId="ana-component-demand">
      <DataTable
        caption="Popyt na składniki: z zestawów i osobno"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.variant}
        cardView={{
          title: (r) => VARIANTS[r.variant].name,
          subtitle: (r) => VARIANTS[r.variant].sku,
          meta: (r) => <span className="tabular">{fmt.number(r.viaBundles)} z zestawów</span>,
          summary: (r) => (
            <span className="tabular">
              osobno {fmt.number(r.alone)} · dostępne {fmt.number(r.available)}
            </span>
          ),
        }}
      />
      <p className="data-table__footnote">
        Zestaw schodzi ze stanu składnikami, więc kawa sprzedana w zestawach zmniejsza ten sam stan co kawa sprzedana osobno. Łyżeczka ma tylko {fmt.number(Math.max(0, VARIANTS.spoon.stock - VARIANTS.spoon.held))} szt. dostępne, a jest gratisem w Zestawie porannym v2: dostępność zestawu liczy się z najmniej dostępnego składnika.
      </p>
    </AnaPanel>
  );
}
