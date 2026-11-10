/**
 * v1 "Produkty i zestawy": one product list with a "Zestawy" filter and a
 * one-screen bundle form (product, components with quantity, one availability
 * line). Price split, availability and channels are automatic; history is a tab.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { DetailSection } from '@web/shared/ui/detail-section';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { InlineDisclosure } from '@web/shared/ui/inline-disclosure';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/shared/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@web/shared/ui/dropdown-menu';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, VARIANTS, type Bundle, type BundleComponent } from '../model/catalog';
import { bundleAtp, latest } from '../model/calc';
import { commonStates, useMoney, useWriteGuard, type ScreenDef } from '../proto';
import { BundleMark, GiftMark } from '../ui/marks';
import { SUBIEKT_KIT, shortName, splitWithPrices, usedIn, type VariantKey } from './cfg-data';
import './cfg.css';
import './v1-catalog.css';

type Filter = 'all' | 'bundles';

interface Row {
  key: string;
  kind: 'product' | 'bundle';
  name: string;
  sku: string;
  image: string;
  price: number;
  available: number | null;
  limiting: string | null;
  /** One-sentence reason shown under the single badge. */
  reason?: { tone: 'warning' | 'neutral' | 'info'; badge: string; text: string };
  components?: BundleComponent[];
  from: 'PrestaShop' | 'Subiekt GT';
}

const BUNDLE_ROWS: { key: string; bundle: Bundle; from: Row['from'] }[] = [
  { key: 'morning', bundle: BUNDLES.morning, from: 'PrestaShop' },
  { key: 'brew', bundle: BUNDLES.brew, from: 'PrestaShop' },
  { key: 'triple', bundle: BUNDLES.triple, from: 'PrestaShop' },
  { key: 'grind', bundle: SUBIEKT_KIT, from: 'Subiekt GT' },
];

const PRODUCT_KEYS: VariantKey[] = ['coffee', 'mug', 'press', 'spoon', 'tea', 'book', 'grinder'];

/** The single "Dostępność nieznana" family: one badge, one sentence, never four alerts. */
const UNKNOWN_REASONS: Record<string, Row['reason']> = {
  morning: { tone: 'warning', badge: 'Dostępność nieznana', text: 'Kubek nie przyszedł w ostatniej synchronizacji z PrestaShop. Kanały mają ostatnią znaną ilość, dopóki kubek nie wróci.' },
  brew: { tone: 'warning', badge: 'Dostępność nieznana', text: 'Zaparzacz jest zarchiwizowany w PrestaShop. Zestaw nie trafia do kanałów, zamień składnik albo przywróć produkt.' },
  triple: { tone: 'info', badge: 'Sprawdź w PrestaShop', text: 'Pak w PrestaShop ma własny stan (8 szt.). OpenLinker liczy ze składników (42 szt.) i zdejmuje stan kawy przy sprzedaży.' },
  grind: { tone: 'neutral', badge: 'Złóż w Subiekcie', text: 'Komplet w Subiekcie trzeba złożyć przed wydaniem. Dostępność liczymy ze składników, więc kanały widzą 9 szt.' },
};

function buildRows(filter: Filter, withReasons: boolean): Row[] {
  const bundles: Row[] = BUNDLE_ROWS.map(({ key, bundle, from }) => {
    const comps = latest(bundle);
    const atp = bundleAtp(comps);
    return { key, kind: 'bundle', name: bundle.name, sku: bundle.sku, image: bundle.image, price: bundle.price, available: atp.atp, limiting: atp.limiting, components: comps, from, reason: withReasons ? UNKNOWN_REASONS[key] : undefined };
  });
  if (filter === 'bundles') return bundles;
  const products: Row[] = PRODUCT_KEYS.map((k) => {
    const v = VARIANTS[k];
    return { key: k, kind: 'product', name: v.name, sku: v.sku, image: v.image, price: v.price, available: Math.max(0, v.stock - v.held), limiting: null, from: v.master === 'subiekt' ? 'Subiekt GT' : 'PrestaShop' };
  });
  return [...bundles, ...products];
}

function ProductList({ state, readOnly }: { state: string; readOnly: boolean }): ReactElement {
  const money = useMoney();
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !readOnly;
  const reason = readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;
  const [filter, setFilter] = useState<Filter>(state === 'availability-unknown' ? 'bundles' : 'all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(filter, state === 'availability-unknown'), [filter, state]);
  const usedInMug = state === 'used-in';

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'product', header: 'Produkt',
      cell: (r) => (
        <div className="cfg-ident">
          <ProductThumbnail src={r.image} name={r.name} size="sm" />
          <span className="cfg-ident__text">
            <span className="cfg-ident__name">{r.name}</span>
            <span className="cfg-ident__meta">
              {r.kind === 'bundle' ? <BundleMark compact /> : null}
              <span>{r.sku}</span>
            </span>
          </span>
        </div>
      ),
    },
    {
      id: 'available', header: 'Dostępne', align: 'right',
      cell: (r) =>
        r.reason ? (
          <span className="cfg-cell-stack">
            <StatusBadge tone={r.reason.tone} compact withDot>{r.reason.badge}</StatusBadge>
          </span>
        ) : (
          <span className="cfg-cell-stack">
            <span className="cfg-num cfg-strong">{r.available ?? '-'} szt.</span>
            {r.limiting ? <span className="cfg-muted">ogranicza: {shortName(r.limiting)}</span> : null}
          </span>
        ),
    },
    { id: 'price', header: 'Cena', align: 'right', hideBelow: 768, cell: (r) => <span className="cfg-num">{money(r.price)}</span> },
    {
      id: 'actions', header: <span className="spike-sr">Akcje</span>, align: 'right',
      cell: (r) =>
        r.kind === 'bundle' ? (
          <Button tone="secondary" className="button--sm" onClick={() => setOpen(open === r.key ? null : r.key)}>
            {open === r.key ? 'Zwiń' : 'Pokaż skład'}
          </Button>
        ) : (
          <Button tone="ghost" className="button--sm" disabled={!canWrite} title={reason}>Zrób z tego zestaw</Button>
        ),
    },
  ];

  return (
    <PageLayout
      eyebrow="Katalog"
      title="Produkty i zestawy"
      description="Zestaw to zwykły produkt ze składnikami. Sprzedajesz go jak każdy produkt, a stan schodzi ze składników."
      actions={<Button tone="primary" disabled={!canWrite} title={reason}>Nowy zestaw</Button>}
    >
      {readOnly ? (
        <Alert tone="info" density="compact" title="Tylko do odczytu">Widzisz produkty i składy zestawów. Tworzenie i zmiana zestawu wymagają roli administratora lub operatora.</Alert>
      ) : null}
      <div className="cfg-row cfg-row--between">
        <SegmentedControl<Filter>
          aria-label="Pokaż"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'Wszystkie' }, { value: 'bundles', label: 'Zestawy' }]}
        />
      </div>
      <DataTable
        caption="Produkty i zestawy"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        rowAttributes={(r) => ({ 'data-row': r.key })}
        cardView={{
          title: (r) => r.name,
          subtitle: (r) => r.sku,
          meta: (r) => (r.reason ? <StatusBadge tone={r.reason.tone} compact withDot>{r.reason.badge}</StatusBadge> : <span className="cfg-num">{r.available ?? '-'} szt.</span>),
        }}
      />
      {rows.filter((r) => r.reason).length ? (
        <ul className="v1-reasons" aria-label="Powody">
          {rows.filter((r) => r.reason).map((r) => (
            <li key={r.key}><span className="cfg-strong">{r.name}:</span> {r.reason?.text}</li>
          ))}
        </ul>
      ) : null}
      {open ? <BundleSummary row={rows.find((r) => r.key === open) ?? rows[0]} /> : null}
      {usedInMug ? (
        <DetailSection title="Kubek ceramiczny 350 ml, biały">
          <p className="cfg-secondary">Ten produkt jest składnikiem zestawów. Zmiana jego stanu zmienia dostępność każdego z nich.</p>
          <ul className="cfg-comps">
            {usedIn('mug').map((u) => (
              <li key={u.key}><span className="cfg-comps__qty">{u.qty} x</span> w zestawie {u.bundle.name}{u.gift ? <GiftMark compact /> : null}</li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
    </PageLayout>
  );
}

function BundleSummary({ row }: { row: Row }): ReactElement {
  return (
    <DetailSection title={`Skład: ${row.name}`}>
      <ul className="cfg-comps">
        {(row.components ?? []).map((c) => (
          <li key={c.variant}>
            <span className="cfg-comps__qty">{c.qty} x</span>
            {VARIANTS[c.variant].name}
            {c.gift ? <GiftMark compact /> : null}
            {row.limiting === c.variant ? <span className="cfg-muted">ogranicza dostępność</span> : null}
          </li>
        ))}
      </ul>
      <p className="cfg-muted">Skład pochodzi z: {row.from}.</p>
    </DetailSection>
  );
}

/* ── One-screen bundle form ─────────────────────────────────────────── */

interface FormSeed {
  title: string;
  product: string;
  sku: string;
  price: number;
  components: BundleComponent[];
  from?: Row['from'];
  saved?: boolean;
  nestedTried?: boolean;
  priceShareNeeded?: boolean;
  openOrders?: number;
  drift?: boolean;
  subiekt?: boolean;
  tab?: 'compose' | 'history';
}

const FORM_SEEDS: Record<string, FormSeed> = {
  'form-new': { title: 'Nowy zestaw', product: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 6499, components: [{ variant: 'coffee', qty: 1 }, { variant: 'mug', qty: 1 }] },
  'form-from-product': { title: 'Zrób z tego zestaw', product: 'Kawa Etiopia, 3 opakowania', sku: 'KAW-3PAK', price: 9499, components: [{ variant: 'coffee', qty: 3 }], from: 'PrestaShop' },
  'form-gift-slot': { title: 'Zestaw poranny', product: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 6499, components: latest(BUNDLES.morning), from: 'PrestaShop' },
  'form-nested-refused': { title: 'Nowy zestaw', product: 'Zestaw świąteczny', sku: 'ZES-SWIETA', price: 15900, components: [{ variant: 'tea', qty: 1 }, { variant: 'book', qty: 1 }], nestedTried: true },
  'form-price-share': { title: 'Nowy zestaw', product: 'Zestaw z młynkiem', sku: 'KPL-MLYNEK', price: 19900, components: latest(SUBIEKT_KIT), from: 'Subiekt GT', priceShareNeeded: true },
  'form-edit-open-orders': { title: 'Zestaw poranny', product: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 6499, components: latest(BUNDLES.morning), from: 'PrestaShop', openOrders: 3 },
  'form-sync-prestashop': { title: 'Kawa Etiopia, 3 opakowania', product: 'Kawa Etiopia, 3 opakowania', sku: 'KAW-3PAK', price: 9499, components: [{ variant: 'coffee', qty: 3 }], from: 'PrestaShop', drift: true },
  'form-subiekt': { title: 'Zestaw z młynkiem', product: 'Zestaw z młynkiem', sku: 'KPL-MLYNEK', price: 19900, components: latest(SUBIEKT_KIT), from: 'Subiekt GT', subiekt: true },
  saved: { title: 'Zestaw do parzenia', product: 'Zestaw do parzenia', sku: 'ZES-PARZENIE', price: 13900, components: latest(BUNDLES.brew), from: 'PrestaShop', saved: true },
  history: { title: 'Zestaw poranny', product: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 6499, components: latest(BUNDLES.morning), from: 'PrestaShop', tab: 'history' },
};

function BundleForm({ seed }: { seed: FormSeed }): ReactElement {
  const money = useMoney();
  const { showToast } = useToast();
  const { canWrite, reason } = useWriteGuard();
  const [comps, setComps] = useState<BundleComponent[]>(seed.components);
  const [query, setQuery] = useState(seed.nestedTried ? 'zestaw poranny' : '');
  const [saved, setSaved] = useState(Boolean(seed.saved));
  const [tab, setTab] = useState<'compose' | 'history'>(seed.tab ?? 'compose');
  const atp = bundleAtp(comps);
  const split = splitWithPrices(seed.price, comps, (k) => (seed.priceShareNeeded && k === 'grinder' ? null : VARIANTS[k]?.price ?? null));

  const suggestions = query.trim().length < 2 ? [] : Object.entries(VARIANTS).filter(([k, v]) => v.name.toLowerCase().includes(query.toLowerCase()) && !comps.some((c) => c.variant === k)).slice(0, 4);
  const nestedHit = query.trim().length >= 2 && Object.values(BUNDLES).some((b) => b.name.toLowerCase().includes(query.toLowerCase()));

  const setQty = (variant: string, qty: number): void => setComps((cs) => cs.map((c) => (c.variant === variant ? { ...c, qty: Math.max(1, qty) } : c)));
  const toggleGift = (variant: string): void => setComps((cs) => cs.map((c) => (c.variant === variant ? { ...c, gift: !c.gift } : c)));
  const remove = (variant: string): void => setComps((cs) => cs.filter((c) => c.variant !== variant));
  const add = (variant: string): void => {
    setComps((cs) => [...cs, { variant, qty: 1 }]);
    setQuery('');
  };
  const save = (): void => {
    setSaved(true);
    showToast({ tone: 'success', description: `Zapisano zestaw ${seed.product}.` });
  };

  return (
    <PageLayout
      eyebrow="Produkty i zestawy"
      title={seed.title}
      description="Zestaw to produkt ze składnikami. Wystarczy wybrać składniki i ilości, resztę OpenLinker policzy sam."
      actions={
        <div className="cfg-row">
          {seed.drift ? (
            <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => { setComps([{ variant: 'coffee', qty: 3 }]); showToast({ tone: 'success', description: 'Zsynchronizowano skład z PrestaShop.' }); }}>
              Synchronizuj skład z PrestaShop
            </Button>
          ) : null}
          <Button tone="primary" disabled={!canWrite || comps.length === 0} title={reason} onClick={save}>Zapisz zestaw</Button>
        </div>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'compose' | 'history')}>
        <TabsList aria-label="Zestaw">
          <TabsTrigger value="compose">Skład</TabsTrigger>
          <TabsTrigger value="history">Historia</TabsTrigger>
        </TabsList>
        <TabsContent value="compose">
          <div className="cfg-stack">
            {saved ? (
              <Alert tone="success" title="Zestaw zapisany" action={<Button tone="secondary" className="button--sm">Wystaw ofertę</Button>}>
                Zestaw sprzedajesz jak każdy produkt. Kanały dostaną ilość {atp.atp ?? '-'} szt. przy najbliższej synchronizacji.
                {seed.saved ? ' Allegro dostanie producenta zestawu, bo składniki mają różnych producentów (GPSR). Shoper wysyła składniki osobno, więc OpenLinker połączy je w zestaw przy przyjęciu zamówienia.' : ''}
              </Alert>
            ) : null}
            {seed.drift ? (
              <Alert tone="info" density="compact" title="Skład w PrestaShop się zmienił">
                Pak w PrestaShop ma teraz 2 opakowania zamiast 3. Synchronizacja zapisze nowy skład; otwarte zamówienia zostaną przy swoim.
              </Alert>
            ) : null}
            {seed.subiekt ? (
              <Alert tone="info" density="compact" title="Skład pochodzi z Subiekta">
                To komplet z Subiekta GT. Skład zmieniasz w Subiekcie, tutaj widzisz go tylko do odczytu. Przed wydaniem komplet trzeba złożyć w Subiekcie.
              </Alert>
            ) : null}

            <DetailSection title="Produkt">
              <div className="v1-form-grid">
                <FormField label="Nazwa zestawu" name="bundle-name"><Input defaultValue={seed.product} disabled={!canWrite || seed.subiekt} /></FormField>
                <FormField label="SKU" name="bundle-sku"><Input defaultValue={seed.sku} disabled={!canWrite || seed.subiekt} /></FormField>
                <FormField label="Cena brutto" name="bundle-price"><Input defaultValue={money(seed.price).replace(/\s?zł/, '')} inputMode="decimal" disabled={!canWrite || seed.subiekt} /></FormField>
              </div>
            </DetailSection>

            <DetailSection title="Składniki">
              <ul className="v1-comp-list">
                {comps.map((c) => (
                  <li key={c.variant} className="v1-comp">
                    <ProductThumbnail src={VARIANTS[c.variant].image} name={VARIANTS[c.variant].name} size="sm" />
                    <span className="v1-comp__name">
                      {VARIANTS[c.variant].name}
                      {c.gift ? <GiftMark compact /> : null}
                    </span>
                    <label className="v1-comp__qty">
                      <span className="spike-sr">Ilość</span>
                      <Input type="number" min={1} value={c.qty} onChange={(e) => setQty(c.variant, Number(e.target.value))} disabled={!canWrite || seed.subiekt} />
                    </label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button tone="ghost" className="button--sm" aria-label={`Więcej: ${VARIANTS[c.variant].name}`} disabled={!canWrite || seed.subiekt}>Więcej</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => toggleGift(c.variant)}>{c.gift ? 'Usuń oznaczenie gratisu' : 'Oznacz jako gratis'}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => remove(c.variant)}>Usuń składnik</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
              {!seed.subiekt ? (
                <div className="v1-add">
                  <FormField label="Dodaj składnik" name="component-search">
                    <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj po nazwie lub SKU" disabled={!canWrite} />
                  </FormField>
                  {nestedHit ? (
                    <p className="v1-field-error" role="alert">Zestaw nie może być składnikiem innego zestawu. Dodaj jego składniki osobno.</p>
                  ) : null}
                  {suggestions.length ? (
                    <ul className="v1-suggest">
                      {suggestions.map(([k, v]) => (
                        <li key={k}><button type="button" className="cfg-link" onClick={() => add(k)}>{v.name} <span className="cfg-muted">{v.sku}</span></button></li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <p className="v1-availability" aria-live="polite">
                {atp.atp === null ? 'Dostępność nieznana: jeden ze składników nie przyszedł w synchronizacji.' : `Dostępne: ${atp.atp} szt.${atp.limiting ? `, ogranicza ${shortName(atp.limiting)}` : ''}`}
              </p>
            </DetailSection>

            {split.missing.length ? (
              <Alert tone="warning" density="compact" title="Podaj udział młynka w cenie">
                Młynek nie jest sprzedawany osobno i nie ma kosztu zakupu, więc OpenLinker nie podzieli ceny sam. Udział jest potrzebny tylko przy zwrocie jednego składnika i na dokumencie ze składnikami.
                <span className="v1-inline-field">
                  <Input aria-label="Udział młynka w cenie" placeholder="np. 129,00" inputMode="decimal" disabled={!canWrite} />
                </span>
              </Alert>
            ) : null}

            {seed.openOrders ? (
              <p className="cfg-secondary">Zapis zmienia skład dla nowych zamówień. {seed.openOrders} otwarte zamówienia zostają przy składzie, z którym je przyjęto.</p>
            ) : null}

            <InlineDisclosure label="Podział ceny" value="automatycznie, z cen składników osobno" changeLabel="Pokaż">
              <ul className="cfg-comps">
                {split.lines.map((l) => (
                  <li key={l.variant}><span className="cfg-comps__qty">{l.qty} x</span>{shortName(l.variant)}: <span className="cfg-num">{money(l.share)}</span></li>
                ))}
              </ul>
              <p className="cfg-muted">Liczy się sam. Przydaje się przy zwrocie jednego składnika i gdy dokument pokazuje składniki.</p>
            </InlineDisclosure>
          </div>
        </TabsContent>
        <TabsContent value="history">
          <DetailSection title="Historia składu">
            <ul className="cfg-list">
              <li><span className="cfg-strong">2 lis 2026: dodano łyżeczkę jako gratis</span><span className="cfg-muted">3 otwarte zamówienia mają skład bez łyżeczki i tak zostaną wysłane.</span></li>
              <li><span className="cfg-strong">2 paź 2026: utworzono zestaw</span><span className="cfg-muted">Kubek i kawa Etiopia.</span></li>
            </ul>
          </DetailSection>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

function Screen({ state }: { state: string }): ReactElement {
  const seed = FORM_SEEDS[state];
  if (seed) return <BundleForm seed={seed} />;
  return <ProductList state={state} readOnly={state === 'viewer-readonly'} />;
}

export const screen: ScreenDef = {
  id: 'products',
  group: 'Katalog',
  label: 'Produkty i zestawy',
  states: [
    { id: 'list', label: 'Lista', note: 'Produkty i zestawy na jednej liście, filtr "Zestawy". Wiersz pokazuje nazwę, SKU, dostępne i cenę, skład po kliknięciu. Pod spodem: OpenLinker rozkłada zestaw na składniki i liczy dostępność jako minimum ze składników.', useCases: ['B-02', 'B-16'], priority: 'pilot' },
    { id: 'availability-unknown', label: 'Dostępność nieznana', note: 'Zamiast czterech różnych alarmów jeden znacznik i jedno zdanie powodu: składnik nie przyszedł, składnik zarchiwizowany, pak PrestaShop z własnym stanem, komplet Subiekta do złożenia. Pod spodem: integracja PrestaShop i Subiekt czyta stan składników i paków; OpenLinker przy niepewnym stanie nie wysyła nowej ilości.', useCases: ['B-02', 'B-01', 'B-03', 'B-22'], priority: 'pilot' },
    { id: 'used-in', label: 'Produkt w zestawach', note: 'Przy produkcie widać, w których zestawach jest składnikiem i czy jako gratis. Zmiana stanu kubka zmienia dostępność tych zestawów.', useCases: ['B-02', 'B-26'], priority: 'pilot' },
    { id: 'form-new', label: 'Nowy zestaw', note: 'Jeden ekran zamiast kreatora w 5 krokach: nazwa, SKU, cena, składniki z ilością i jedna linia dostępności. Decyzja: tak robią BaseLinker, Apilo, Sellasist, Shopify i PrestaShop.', useCases: ['B-01'], priority: 'pilot' },
    { id: 'form-from-product', label: 'Zrób z tego zestaw', note: 'Akcja na istniejącym produkcie, jak "Zmień produkt na zestaw" w Apilo. Tak zamienisz multipak z Allegro na zestaw "3 x kawa".', useCases: ['B-01', 'B-03'], priority: 'pilot' },
    { id: 'form-gift-slot', label: 'Gratis w składzie zestawu', note: 'Łyżeczka jest składnikiem oznaczonym jako gratis, ustawionym w menu "Więcej" przy składniku. Pakowacz ją skanuje, stan schodzi z powodem "gratis".', useCases: ['B-01'], priority: 'pilot' },
    { id: 'form-nested-refused', label: 'Zestaw w zestawie', note: 'Wpisanie nazwy zestawu w wyszukiwarce składnika pokazuje od razu, że zestaw nie może być składnikiem. Bez osobnego kroku.', useCases: ['B-26', 'B-01'], priority: 'pilot' },
    { id: 'form-price-share', label: 'Udział w cenie tylko gdy trzeba', note: 'Podział ceny liczy się sam z cen osobno. Pole pojawia się tylko, gdy składnik nie ma ani ceny, ani kosztu. Decyzja: nikt na rynku nie każe dzielić ceny przy definicji.', useCases: ['B-14'], priority: 'pilot' },
    { id: 'form-edit-open-orders', label: 'Zmiana przy otwartych zamówieniach', note: 'Jedno zdanie przy zapisie: otwarte zamówienia zostają przy swoim składzie. Bez numerów wersji w interfejsie.', useCases: ['B-10'], priority: 'pilot' },
    { id: 'form-sync-prestashop', label: 'Synchronizuj skład z PrestaShop', note: 'Pak w PrestaShop zmienił skład. Jeden przycisk zapisuje nowy skład; bez ekranu porównania. Pod spodem: integracja PrestaShop czyta skład paku.', useCases: ['B-18'], priority: 'pilot' },
    { id: 'form-subiekt', label: 'Komplet z Subiekta', note: 'Skład kompletu przychodzi z Subiekta GT i jest tylko do odczytu. Pod spodem: integracja Subiekt czyta komplety; OpenLinker liczy dostępność ze składników.', useCases: ['B-03', 'B-18'], priority: 'pilot' },
    { id: 'saved', label: 'Zapisany, wystaw ofertę', note: 'Po zapisie link "Wystaw ofertę" zamiast kroku kanałów. Jedno zdanie o tym, co kanały zrobią same: producent zestawu dla GPSR, Shoper wysyła składniki osobno. Pod spodem: integracja kanału publikuje zestaw jak każdy produkt i rozpoznaje jego kształt w zamówieniu.', useCases: ['B-17', 'B-05'], priority: 'pilot' },
    { id: 'history', label: 'Historia składu', note: 'Historia to zakładka, a nie panel przy każdym kroku. Mówi, kiedy zmienił się skład i co dzieje się z otwartymi zamówieniami.', useCases: ['B-10', 'B-01'], priority: 'later' },
    { id: 'viewer-readonly', label: 'Tylko do odczytu', note: 'Użytkownik bez uprawnień widzi produkty i składy, ale nie tworzy ani nie zmienia zestawów. Wyłączone przyciski mówią dlaczego.', useCases: ['B-02'], priority: 'pilot' },
    ...commonStates('produktów', 'Nowy zestaw'),
  ],
  render: (state) => <Screen state={state} />,
};
