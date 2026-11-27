/**
 * Zestawy (catalogue): every OpenLinker-defined bundle with availability from its
 * components, cost and margin, channels and what needs attention. A component
 * opens a "Used in bundles" panel (reverse lookup).
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { DetailSection } from '@web/shared/ui/detail-section';
import { MetricCard } from '@web/shared/ui/metric-card';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web/shared/ui/dialog';
import { useToast } from '@web/shared/ui/toast-provider';
import { CHANNELS, VARIANTS, type Bundle, type BundleComponent, type ChannelId } from '../model/catalog';
import { bundleAtp, bundleCost } from '../model/calc';
import { commonStates, useMoney, useProto, useWriteGuard, type ScreenDef } from '../proto';
import { BundleMark, GiftMark, StockPathTrail, type TrailStep } from '../ui/marks';
import { ALL_BUNDLES, bundleNet, marginPct, pct, shortName, usedIn } from './cfg-data';
import './cfg.css';

type Scenario = 'main' | 'component-stale' | 'publish-suppressed' | 'master-pack-stock' | 'component-archived' | 'master-drift' | 'subiekt-not-assembled' | 'used-in';

interface CompFlag {
  text: string;
  tone: 'warning' | 'error';
}

interface Row {
  key: string;
  bundle: Bundle;
  master: 'prestashop' | 'subiekt';
  comps: BundleComponent[];
  version: number;
  atp: number | null;
  limiting: string | null;
  cost: number | null;
  margin: number | null;
  channels: { id: ChannelId; off: boolean }[];
  status: { tone: StatusBadgeTone; label: string; detail?: string };
  flags: Record<string, CompFlag>;
  /** Number published to channels when it differs from the computed one. */
  published?: string;
}

function buildRows(scenario: Scenario): Row[] {
  return ALL_BUNDLES.map(({ key, bundle, master }) => {
    const latestV = bundle.versions[bundle.versions.length - 1];
    const comps = latestV.components;
    const res = bundleAtp(comps);
    const cost = bundleCost(comps);
    const net = bundleNet(bundle.price, comps);
    const row: Row = {
      key, bundle, master, comps, version: latestV.version, atp: res.atp, limiting: res.limiting, cost, margin: marginPct(net, cost),
      channels: bundle.channels.map((id) => ({ id, off: false })),
      status: { tone: 'success', label: 'Sprzedaje się' }, flags: {},
    };
    if (res.atp !== null && res.atp <= 2) row.status = { tone: 'warning', label: 'Niski stan', detail: `Ogranicza ${shortName(res.limiting ?? '')}` };
    if (cost === null) row.status = { tone: 'neutral', label: 'Sprzedaje się', detail: 'Brak kosztu składnika, marża nieznana' };

    if (scenario === 'component-stale' && comps.some((c) => c.variant === 'mug')) {
      row.atp = null;
      row.limiting = null;
      row.flags.mug = { text: 'nieaktualny w PrestaShop', tone: 'error' };
      row.status = { tone: 'error', label: 'Dostępność nieznana', detail: 'Publikacja ilości wstrzymana' };
      row.published = 'nic nie wysłano';
    }
    if (scenario === 'publish-suppressed' && key === 'brew') {
      row.flags.press = { text: 'odczyt stanu nie powiódł się', tone: 'warning' };
      row.status = { tone: 'warning', label: 'Publikacja wstrzymana', detail: 'Ostatnia ilość 11 szt., 3 godz. temu' };
      row.published = 'wstrzymano, ostatnio 11';
    }
    if (scenario === 'master-pack-stock' && key === 'brew') {
      row.status = { tone: 'warning', label: 'Pak z własnym stanem', detail: 'PrestaShop liczy pak osobno: 12 szt.' };
      row.published = 'OL liczy z części';
    }
    if (scenario === 'component-archived' && key === 'morning') {
      row.atp = 0;
      row.limiting = 'spoon';
      row.flags.spoon = { text: 'zarchiwizowany', tone: 'error' };
      row.status = { tone: 'error', label: 'Nie sprzedaje się', detail: 'Składnik zarchiwizowany, wysłano 0 szt.' };
      row.channels = row.channels.map((c) => ({ ...c, off: true }));
    }
    if (scenario === 'master-drift' && key === 'brew') {
      row.flags.coffee = { text: 'w PrestaShop 1 szt., w OL 2 szt.', tone: 'warning' };
      row.status = { tone: 'conflict', label: 'Rozjazd z masterem', detail: 'Skład paka w PrestaShop jest inny' };
    }
    if (scenario === 'subiekt-not-assembled' && key === 'grind') {
      row.status = { tone: 'warning', label: 'Komplet niezłożony', detail: 'Subiekt GT: 0 szt. do złożenia' };
      row.published = 'Subiekt: 0, z części: ' + String(res.atp);
    }
    return row;
  });
}

function ChannelList({ channels }: { channels: Row['channels'] }): ReactElement {
  return (
    <span className="cfg-channels">
      {channels.map(({ id, off }) => (
        <span key={id} className={`cfg-channel${off ? ' cfg-channel--off' : ''}`} title={off ? 'Ilość 0 wysłana do kanału' : undefined}>
          <span className="cfg-channel__dot" style={{ background: `var(${CHANNELS[id].colorVar})` }} aria-hidden="true" />
          {CHANNELS[id].name}
        </span>
      ))}
    </span>
  );
}

function ComponentList({ row, onPick }: { row: Row; onPick: (variant: string) => void }): ReactElement {
  return (
    <ul className="cfg-comps">
      {row.comps.map((c) => {
        const flag = row.flags[c.variant];
        return (
          <li key={c.variant}>
            <span className="cfg-comps__qty tabular">{c.qty} x</span>
            <button type="button" className="cfg-link" onClick={() => onPick(c.variant)} title="Pokaż, w jakich zestawach jest ten składnik">
              {shortName(c.variant)}
            </button>
            {c.gift ? <GiftMark compact /> : null}
            {flag ? <span className={`cfg-comps__flag${flag.tone === 'error' ? ' cfg-comps__flag--error' : ''}`}>{flag.text}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function trailFor(oms: boolean, master: string): TrailStep[] {
  return oms
    ? [
        { label: 'Zarezerwowano składniki', state: 'done' },
        { label: 'Spakowano (skan każdego składnika)', state: 'active' },
        { label: `Zdjęto ze stanu w ${master}`, state: 'todo', detail: 'osobno każdy składnik' },
      ]
    : [
        { label: `Wysłano do ${master} jako pozycja zestawu`, state: 'done' },
        { label: 'Sklep zdjął stan', state: 'todo', detail: 'według ustawień paka w sklepie' },
      ];
}

function RowDetail({ row, scenario }: { row: Row; scenario: Scenario }): ReactElement {
  const { oms } = useProto();
  const res = bundleAtp(row.comps);
  const masterName = row.master === 'subiekt' ? 'Subiekt GT' : 'PrestaShop';
  return (
    <div className="cfg-stack">
      <div className="cfg-scroll">
        <table className="cfg-table">
          <caption className="sr-only">Dostępność składników</caption>
          <thead>
            <tr>
              <th scope="col">Składnik</th>
              <th scope="col" className="cfg-right">Dostępne</th>
              <th scope="col" className="cfg-right">Na zestaw</th>
              <th scope="col" className="cfg-right">Starczy na</th>
            </tr>
          </thead>
          <tbody>
            {res.perComponent.map((p) => (
              <tr key={p.variant} className={p.variant === row.limiting ? 'cfg-row--limit' : undefined}>
                <th scope="row">
                  {shortName(p.variant)} {p.variant === row.limiting ? <StatusBadge tone="neutral" compact>Ogranicza</StatusBadge> : null}
                </th>
                <td className="cfg-right tabular">{row.flags[p.variant]?.tone === 'error' ? '?' : p.available}</td>
                <td className="cfg-right tabular">{p.qty}</td>
                <td className="cfg-right tabular">{row.flags[p.variant]?.tone === 'error' ? '?' : `${p.sets} zest.`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scenario === 'master-drift' && row.key === 'brew' ? (
        <div className="cfg-scroll">
          <table className="cfg-table">
            <caption className="sr-only">Skład w OpenLinkerze i w PrestaShop</caption>
            <thead>
              <tr>
                <th scope="col">Składnik</th>
                <th scope="col" className="cfg-right">OpenLinker (v1)</th>
                <th scope="col" className="cfg-right">Pak w PrestaShop</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Zaparzacz French press</th>
                <td className="cfg-right tabular">1</td>
                <td className="cfg-right tabular">1</td>
              </tr>
              <tr className="cfg-row--error">
                <th scope="row">Kawa Etiopia 250 g</th>
                <td className="cfg-right tabular">2</td>
                <td className="cfg-right tabular">1</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      <div>
        <p className="cfg-muted">Gdzie schodzi stan po sprzedaży ({oms ? 'OMS włączony' : 'OMS wyłączony'})</p>
        <StockPathTrail steps={trailFor(oms, masterName)} />
      </div>
    </div>
  );
}

function UsedInPanel({ variant, onClose }: { variant: string; onClose?: () => void }): ReactElement {
  const money = useMoney();
  const { go } = useProto();
  const v = VARIANTS[variant];
  const list = usedIn(variant);
  return (
    <DetailSection
      title={`Używany w zestawach: ${shortName(variant)}`}
      titleAside={onClose ? <Button tone="ghost" onClick={onClose}>Zamknij</Button> : undefined}
    >
      <div className="cfg-stack cfg-stack--tight">
        <div className="cfg-ident">
          <ProductThumbnail src={v.image} name={v.name} size="sm" />
          <span className="cfg-ident__text">
            <span className="cfg-ident__name">{v.name}</span>
            <span className="cfg-ident__meta">
              <span className="mono-text">{v.sku}</span>
              <span className="tabular">dostępne {Math.max(0, v.stock - v.held)} szt.</span>
              <span className="tabular">{money(v.price, 'PLN')}</span>
            </span>
          </span>
        </div>
        <p className="cfg-secondary">
          {list.length === 1 ? 'Ten składnik jest w 1 zestawie.' : `Ten składnik jest w ${list.length} zestawach.`} Zmiana jego stanu przelicza dostępność każdego z nich i wysyła nowe ilości do kanałów.
        </p>
        <ul className="cfg-list">
          {list.map((u) => (
            <li key={u.key}>
              <span className="cfg-row cfg-row--between">
                <button type="button" className="cfg-link" onClick={() => go('bundle-editor', 'step-components')}>
                  {u.bundle.name}
                </button>
                <span className="cfg-muted tabular">v{u.version}</span>
              </span>
              <span className="cfg-muted">
                {u.qty} szt. na zestaw{u.gift ? ', jako gratis w zestawie' : ''}
              </span>
            </li>
          ))}
        </ul>
        {variant === 'mug' ? <p className="cfg-muted">Dwie wersje Zestawu porannego mają kubek. Zamówienia na v1 trzymają swój skład, więc rezerwacje kubka liczą się z obu.</p> : null}
      </div>
    </DetailSection>
  );
}

function ScenarioAlert({ scenario }: { scenario: Scenario }): ReactElement | null {
  const { go } = useProto();
  const { showToast } = useToast();
  const { canWrite, reason } = useWriteGuard();
  const act = (title: string, description: string) => () => showToast({ title, description, tone: 'success' });
  const write = (label: string, onClick: () => void): ReactNode => (
    <Button tone="secondary" disabled={!canWrite} title={reason} onClick={onClick}>
      {label}
    </Button>
  );
  switch (scenario) {
    case 'component-stale':
      return (
        <Alert tone="error" title="Kubek ceramiczny jest nieaktualny w PrestaShop">
          Kubek nie przyszedł w ostatniej synchronizacji z PrestaShop. Dostępność Zestawu porannego jest nieznana, więc OpenLinker wstrzymał wysyłanie ilości do kanałów: nie wyśle starej liczby ani zera. Sprawdź produkt w PrestaShop albo zamień składnik.
        </Alert>
      );
    case 'publish-suppressed':
      return (
        <Alert tone="warning" title="Publikacja ilości Zestawu do parzenia wstrzymana" action={write('Przelicz ponownie', act('Przeliczono ponownie', 'Zestaw do parzenia: 11 szt. wysłano do 4 kanałów.'))}>
          Odczyt stanu zaparzacza z PrestaShop nie powiódł się. OpenLinker nie zna pewnej dostępności, więc nie wysłał nowej ilości. Kanały mają ostatnią wysłaną liczbę: 11 szt. sprzed 3 godzin.
        </Alert>
      );
    case 'master-pack-stock':
      return (
        <Alert tone="warning" title="Zestaw do parzenia jest w PrestaShop pakiem z własnym stanem" action={write('Licz z części w OpenLinkerze', act('Ustawiono liczenie z części', 'Zestaw do parzenia: dostępność liczona ze składników.'))}>
          PrestaShop trzyma osobny stan paka (12 szt.), a OpenLinker liczy zestaw ze składników (11 szt.). Po sprzedaży OpenLinker zdejmie stan składników, a PrestaShop nie zmniejszy stanu paka, więc liczby się rozjadą. Ustaw w PrestaShop stan paka liczony z produktów albo usuń definicję w OpenLinkerze.
        </Alert>
      );
    case 'component-archived':
      return (
        <Alert tone="error" title="Zestaw poranny przestał się sprzedawać" action={<Button tone="secondary" onClick={() => go('bundle-editor', 'step-components')}>Napraw skład</Button>}>
          Łyżeczka do kawy jest zarchiwizowana. Bez niej zestawu nie da się skompletować, więc OpenLinker wysłał 0 szt. do Allegro, PrestaShop i Erli. Usuń łyżeczkę ze składu albo zamień ją na inny gratis.
        </Alert>
      );
    case 'master-drift':
      return (
        <Alert tone="info" title="Skład w PrestaShop jest inny niż w OpenLinkerze" action={write('Synchronizuj skład z PrestaShop', act('Zsynchronizowano skład z PrestaShop', 'Zapisano wersję v2 Zestawu do parzenia. Otwarte zamówienia trzymają v1.'))}>
          Synchronizacja zmieni kawę z 2 na 1 szt. i zapisze to jako nową wersję. Otwarte zamówienia zostają na swojej wersji. OpenLinker nie robi tego sam, dopóki nie klikniesz.
        </Alert>
      );
    case 'subiekt-not-assembled':
      return (
        <Alert tone="warning" title="Komplet w Subiekcie GT jest niezłożony" action={write('Licz z części w OpenLinkerze', act('Ustawiono liczenie z części', 'Zestaw z młynkiem: 9 szt. wysłano do Allegro i Erli.'))}>
          Subiekt GT pokazuje stan kompletu dopiero po złożeniu go dokumentem kompletacji. Teraz to 0 szt., chociaż części starczą na 9 zestawów. Złóż komplety w Subiekcie albo pozwól OpenLinkerowi liczyć dostępność z części.
        </Alert>
      );
    default:
      return null;
  }
}

function BundlesScreen({ scenario }: { scenario: Scenario }): ReactElement {
  const money = useMoney();
  const { go, role } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const [picked, setPicked] = useState<string | null>(scenario === 'used-in' ? 'mug' : null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const rows = buildRows(scenario);
  const showCost = role !== 'packer';
  const attention = rows.filter((r) => r.status.tone === 'error' || r.status.tone === 'warning' || r.status.tone === 'conflict').length;
  const inline = scenario === 'used-in';

  const pick = (variant: string): void => {
    setPicked(variant);
    if (!inline) setDialogOpen(true);
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'name',
      header: 'Zestaw',
      cell: (r) => (
        <span className="cfg-ident">
          <ProductThumbnail src={r.bundle.image} name={r.bundle.name} size="sm" />
          <span className="cfg-ident__text">
            <span className="cfg-ident__name">{r.bundle.name}</span>
            <span className="cfg-ident__meta">
              <span className="mono-text">{r.bundle.sku}</span>
              <BundleMark compact label={`v${r.version}`} />
              <span>{r.master === 'subiekt' ? 'Subiekt GT' : 'PrestaShop'}</span>
            </span>
            <span className="cfg-row">
              <StatusBadge tone={r.status.tone} compact withDot>{r.status.label}</StatusBadge>
            </span>
            {r.status.detail ? <span className="cfg-muted">{r.status.detail}</span> : null}
            <ChannelList channels={r.channels} />
          </span>
        </span>
      ),
    },
    { id: 'comps', header: 'Składniki', cell: (r) => <ComponentList row={r} onPick={pick} /> },
    {
      id: 'atp',
      header: 'Dostępne',
      align: 'right',
      cell: (r) => (
        <span className="cfg-cell-stack">
          <span className="tabular cfg-strong">{r.atp === null ? 'nieznane' : `${r.atp} szt.`}</span>
          {r.limiting ? <span className="cfg-muted">ogranicza: {shortName(r.limiting)}</span> : null}
          {r.published ? <span className="cfg-muted">w kanałach: {r.published}</span> : null}
        </span>
      ),
    },
    {
      id: 'price',
      header: showCost ? 'Cena i marża' : 'Cena',
      align: 'right',
      cell: (r) => (
        <span className="cfg-cell-stack">
          <span className="tabular">{money(r.bundle.price, 'PLN')}</span>
          {showCost ? <span className="cfg-muted tabular">koszt {r.cost === null ? 'brak' : money(r.cost, 'PLN')}</span> : null}
          {showCost ? <span className="cfg-muted tabular">marża {pct(r.margin)}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <PageLayout
      title="Zestawy"
      description="Zestawy zdefiniowane w OpenLinkerze. Dostępność liczymy ze składników, a pakowanie i zdjęcie stanu idzie po każdym składniku osobno."
      actions={
        <Button disabled={!canWrite} title={reason} onClick={() => go('bundle-editor', 'step-variant')}>
          Utwórz zestaw
        </Button>
      }
    >
      <div className="cfg-stack">
        <div className="cfg-kpis">
          <MetricCard label="Zestawy" value={<span className="tabular">{rows.length}</span>} description="3 z PrestaShop, 1 z Subiekta GT" />
          <MetricCard label="Wymaga uwagi" value={<span className="tabular">{attention}</span>} tone={attention ? 'warning' : 'neutral'} description="Stan, publikacja albo skład" />
          <MetricCard label="Składniki w kilku zestawach" value={<span className="tabular">2</span>} description="Kubek i kawa Etiopia" />
        </div>
        <ScenarioAlert scenario={scenario} />
        {inline && picked ? <UsedInPanel variant={picked} onClose={() => setPicked(null)} /> : null}
        <div>
          <DataTable
            caption="Zestawy zdefiniowane w OpenLinkerze"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.key}
            expandable={{
              renderDetail: (r) => <RowDetail row={r} scenario={scenario} />,
              toggleLabel: (r, open) => (open ? `Zwiń szczegóły: ${r.bundle.name}` : `Pokaż dostępność składników: ${r.bundle.name}`),
            }}
            cardView={{
              title: (r) => r.bundle.name,
              subtitle: (r) => `${r.bundle.sku} · v${r.version}`,
              meta: (r) => <StatusBadge tone={r.status.tone} compact withDot>{r.status.label}</StatusBadge>,
              summary: (r) => (
                <span className="cfg-stack cfg-stack--tight">
                  <ComponentList row={r} onPick={pick} />
                  <span className="cfg-row">
                    <span className="tabular cfg-strong">{r.atp === null ? 'Dostępność nieznana' : `Dostępne: ${r.atp} szt.`}</span>
                    {r.limiting ? <span className="cfg-muted">ogranicza: {shortName(r.limiting)}</span> : null}
                  </span>
                  <span className="cfg-muted tabular">
                    {money(r.bundle.price, 'PLN')}
                    {showCost ? ` · koszt ${r.cost === null ? 'brak' : money(r.cost, 'PLN')} · marża ${pct(r.margin)}` : ''}
                  </span>
                  {r.status.detail ? <span className="cfg-muted">{r.status.detail}</span> : null}
                  <ChannelList channels={r.channels} />
                </span>
              ),
            }}
          />
        </div>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>Używany w zestawach</DialogTitle>
          <DialogDescription>Zmiana stanu tego składnika przelicza dostępność każdego zestawu z listy.</DialogDescription>
          {picked ? <UsedInPanel variant={picked} /> : null}
          <DialogFooter>
            <Button tone="secondary" onClick={() => setDialogOpen(false)}>Zamknij</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

export const screen: ScreenDef = {
  id: 'bundles',
  group: 'Katalog',
  label: 'Zestawy',
  states: [
    { id: 'main', label: 'Lista zestawów', note: 'Każdy zestaw ma dostępność policzoną ze składników: najmniejsza liczba pełnych kompletów. Rozwiń wiersz, żeby zobaczyć, który składnik ogranicza. Kliknij składnik, żeby zobaczyć, w jakich zestawach jeszcze jest.', useCases: ['B-02', 'B-16'], priority: 'pilot', channels: ['allegro', 'prestashop', 'erli'] },
    { id: 'component-stale', label: 'Składnik nieaktualny', note: 'Kubek nie przyszedł w synchronizacji z PrestaShop. OpenLinker nie zna dostępności zestawu, więc wstrzymuje wysyłanie ilości. Nie wysyła zera, bo to wyłączyłoby oferty bez potrzeby, ani starej liczby, bo mogłaby sprzedać brak.', useCases: ['B-02'], priority: 'pilot', channels: ['allegro', 'prestashop', 'erli'] },
    { id: 'publish-suppressed', label: 'Publikacja wstrzymana', note: 'Odczyt stanu jednego składnika się nie udał. Kanały zostają z ostatnią wysłaną ilością, a OpenLinker pokazuje, ile i kiedy wysłał. Przeliczenie ponawia odczyt.', useCases: ['B-02'], priority: 'pilot', channels: ['allegro', 'prestashop', 'woocommerce', 'shoper'] },
    { id: 'master-pack-stock', label: 'Pak z własnym stanem', note: 'Zestaw do parzenia jest w PrestaShop pakiem, który trzyma własny stan. Gdy OpenLinker zdejmie stan składników, PrestaShop nie zmniejszy paka i powstaje cicha nadsprzedaż (B-22, C-069). Ekran ostrzega przy zapisie i na liście.', useCases: ['B-03', 'B-22'], priority: 'stage0', channels: ['prestashop'] },
    { id: 'component-archived', label: 'Składnik zarchiwizowany', note: 'Łyżeczka (gratis w zestawie) została zarchiwizowana. Zestaw nie da się skompletować, więc kanały dostają 0 szt. Przycisk prowadzi do edytora składu.', useCases: ['B-02', 'B-01'], priority: 'pilot', channels: ['allegro', 'prestashop', 'erli'] },
    { id: 'master-drift', label: 'Rozjazd z masterem', note: 'Pak w PrestaShop ma inny skład niż definicja w OpenLinkerze. Jedno zdanie mówi, co się zmieni, a przycisk synchronizuje skład z PrestaShop na żądanie (w jedną stronę). Synchronizacja tworzy nową wersję, otwarte zamówienia zostają na starej. Decyzja: bez ekranu porównania; BaseLinker, Apilo i Sellasist importują skład z kanału raz lub na żądanie, a Shopify trzyma jednego właściciela składu, więc OL tylko pobiera skład z PrestaShop.', useCases: ['B-18'], priority: 'later', channels: ['prestashop'] },
    { id: 'subiekt-not-assembled', label: 'Komplet Subiekta niezłożony', note: 'W Subiekcie GT komplet ma stan dopiero po złożeniu. Do tego czasu Subiekt pokazuje 0, chociaż części są. Operator wybiera: złożyć komplety w Subiekcie albo liczyć dostępność z części w OpenLinkerze.', useCases: ['B-03', 'B-18'], priority: 'later' },
    { id: 'used-in', label: 'Używany w zestawach', note: 'Panel obok listy pokazuje, w jakich zestawach jest składnik (tu: kubek w 2 zestawach). Zmiana stanu kubka przelicza i publikuje oba zestawy. Kliknij inny składnik w tabeli, żeby przełączyć panel.', useCases: ['B-02', 'B-26'], priority: 'pilot' },
    ...commonStates('zestawów', 'utwórz pierwszy zestaw'),
  ],
  render: (state) => <BundlesScreen key={state} scenario={state as Scenario} />,
};
