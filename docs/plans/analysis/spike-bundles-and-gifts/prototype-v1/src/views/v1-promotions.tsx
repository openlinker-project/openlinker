/**
 * v1 "Promocje z gratisem": list in check order, a composer that starts from
 * three cards and shows four fields, everything else under "Więcej opcji".
 * Self-pause (limit, out of stock) is automatic and visible; no budget in money.
 */
import { useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { DetailSection } from '@web/shared/ui/detail-section';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { FilterCheck, FilterChecks } from '@web/shared/ui/filter-check';
import { InlineDisclosure } from '@web/shared/ui/inline-disclosure';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, CHANNELS, PROMOTIONS, VARIANTS, type ChannelId, type Promotion } from '../model/catalog';
import { commonStates, useProto, useWriteGuard, type ScreenDef } from '../proto';
import { GiftMark, Switch, WhoPaysStrip } from '../ui/marks';
import { ALL_CHANNELS, NO_COST_PROMO, STATUS_LABEL, STATUS_TONE, formatDate, giftWhere, shortName } from './cfg-data';
import './cfg.css';
import './v1-catalog.css';

type Template = 'product' | 'basket' | 'unit';

const TEMPLATES: { id: Template; title: string; example: string }[] = [
  { id: 'product', title: 'Gratis do produktu', example: 'Łyżeczka do każdego Zestawu porannego' },
  { id: 'basket', title: 'Gratis od kwoty zamówienia', example: 'Próbka kawy przy zamówieniu od 150 zł' },
  { id: 'unit', title: 'Gratis do każdej sztuki', example: 'Torba do co drugiego kubka' },
];

const byId = (id: string): Promotion => PROMOTIONS.find((p) => p.id === id) ?? PROMOTIONS[0];

/** One short word per channel: does the channel know the gift, or does OpenLinker add it. */
function channelMarker(id: ChannelId): string {
  const w = giftWhere(id);
  return w.kind === 'native' ? 'natywnie w kanale' : w.kind === 'shop-rule' ? 'reguła koszyka albo OpenLinker' : 'przez OpenLinker';
}

function selfPauseReason(p: Promotion): string | null {
  if (p.status === 'out-of-stock') return `${shortName(p.gift)} skończyła się. Wznowi się sama po dostawie.`;
  if (p.status === 'limit-reached') return `Wydano ${p.given} z ${p.unitCap} szt.`;
  return null;
}

function nameOfSku(sku: string | null): string {
  if (!sku) return '';
  const b = Object.values(BUNDLES).find((x) => x.sku === sku);
  if (b) return b.name;
  const v = Object.values(VARIANTS).find((x) => x.sku === sku);
  return v ? v.name.split(',')[0] : sku;
}

function oneLine(p: Promotion): string {
  const cond = p.minBasket ? `od ${(p.minBasket / 100).toFixed(0)} zł` : `przy ${nameOfSku(p.containsSku)}`;
  return `${shortName(p.gift)} ${cond} · ${p.channels.map((c) => CHANNELS[c].name).join(', ')} · do ${formatDate(p.to)}`;
}

/* ── List ───────────────────────────────────────────────────────────── */

function PromoList({ readOnly }: { readOnly: boolean }): ReactElement {
  const { go } = useProto();
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !readOnly;
  const reason = readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;
  const [order, setOrder] = useState<string[]>(PROMOTIONS.map((p) => p.id));
  const rows = order.map(byId);
  const move = (id: string, dir: -1 | 1): void =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const STATE_FOR: Record<string, string> = { 'promo-spoon': 'active', 'promo-sample': 'paused-out-of-stock', 'promo-bag': 'limit-reached', 'promo-xmas': 'composer-basket', 'promo-oct': 'ended' };

  const columns: DataTableColumn<Promotion>[] = [
    {
      id: 'pos', header: 'Kolejność',
      cell: (p) => {
        const i = order.indexOf(p.id);
        return (
          <span className="v1-pos">
            <span className="cfg-num cfg-strong">{i + 1}</span>
            <Button tone="ghost" className="button--sm" disabled={!canWrite || i === 0} title={reason} aria-label={`Przesuń wyżej: ${p.name}`} onClick={() => move(p.id, -1)}>Wyżej</Button>
            <Button tone="ghost" className="button--sm" disabled={!canWrite || i === order.length - 1} title={reason} aria-label={`Przesuń niżej: ${p.name}`} onClick={() => move(p.id, 1)}>Niżej</Button>
          </span>
        );
      },
    },
    {
      id: 'name', header: 'Promocja',
      cell: (p) => (
        <span className="cfg-ident__text">
          <button type="button" className="cfg-link" onClick={() => go('promotions', STATE_FOR[p.id] ?? 'active')}>{p.name}</button>
          <span className="cfg-muted">{oneLine(p)}</span>
        </span>
      ),
    },
    {
      id: 'status', header: 'Stan',
      cell: (p) => (
        <span className="cfg-cell-stack cfg-cell-stack--start">
          <StatusBadge tone={STATUS_TONE[p.status]} compact withDot>{STATUS_LABEL[p.status]}</StatusBadge>
          {selfPauseReason(p) ? <span className="cfg-muted">{selfPauseReason(p)}</span> : null}
        </span>
      ),
    },
    { id: 'given', header: 'Wydano', align: 'right', hideBelow: 768, cell: (p) => <span className="cfg-num">{p.given}{p.unitCap ? ` z ${p.unitCap}` : ''} szt.</span> },
  ];

  return (
    <PageLayout
      eyebrow="Sprzedaż"
      title="Promocje z gratisem"
      description="OpenLinker dodaje gratis do zamówienia w każdym kanale, także tam, gdzie kanał nie zna gratisów."
      actions={<Button tone="primary" disabled={!canWrite} title={reason} onClick={() => go('promotions', 'new-template')}>Utwórz promocję</Button>}
    >
      {readOnly ? <Alert tone="info" density="compact" title="Tylko do odczytu">Widzisz promocje i ich stan. Zmiany wymagają roli administratora lub operatora.</Alert> : null}
      <p className="cfg-secondary">Promocje sprawdzamy od góry. Jeśli promocja ma włączone "Nie łącz z innymi", niższe już nie dochodzą.</p>
      <DataTable
        caption="Promocje z gratisem w kolejności sprawdzania"
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        cardView={{
          title: (p) => p.name,
          subtitle: (p) => oneLine(p),
          meta: (p) => <StatusBadge tone={STATUS_TONE[p.status]} compact withDot>{STATUS_LABEL[p.status]}</StatusBadge>,
        }}
      />
    </PageLayout>
  );
}

/* ── Start: three cards ─────────────────────────────────────────────── */

function TemplatePicker(): ReactElement {
  const { go } = useProto();
  const target: Record<Template, string> = { product: 'composer-product', basket: 'composer-basket', unit: 'composer-per-unit' };
  return (
    <PageLayout eyebrow="Promocje z gratisem" title="Nowa promocja" description="Wybierz, kiedy klient dostaje gratis. Szczegóły ustawisz w następnym kroku.">
      <div className="v1-templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="v1-template" onClick={() => go('promotions', target[t.id])}>
            <GiftMark compact />
            <span className="v1-template__title">{t.title}</span>
            <span className="cfg-muted">np. {t.example}</span>
          </button>
        ))}
      </div>
    </PageLayout>
  );
}

/* ── Composer ───────────────────────────────────────────────────────── */

interface TestOrder {
  id: string;
  label: string;
  tone: 'success' | 'warning' | 'neutral';
  result: string;
}

const TEST_ORDERS: TestOrder[] = [
  { id: 'o1', label: 'Allegro ALG-7821: Zestaw poranny + 3 x kawa, 179,96 zł', tone: 'success', result: 'Dostanie 1 x Łyżeczka. Pasuje też "Próbka kawy od 150 zł", ale łyżeczka jest wyżej na liście i nie łączy się z innymi, więc próbki nie będzie.' },
  { id: 'o4', label: 'Allegro ALG-7844: Zestaw poranny z łyżeczką w składzie, 89,99 zł', tone: 'neutral', result: 'Bez gratisu. Łyżeczka już jest w zamówieniu jako składnik zestawu, a promocja ma "Pomiń, jeśli produkt jest już w zamówieniu".' },
  { id: 'o3', label: 'Allegro ALG-7830: 5 x kawa, 174,95 zł (kupujący 48213)', tone: 'warning', result: 'Bez gratisu. Ten kupujący dostał już próbkę 12 paź, a limit to 1 na klienta. Klienta rozpoznajemy po koncie w kanale, nie po e-mailu.' },
  { id: 'o2', label: 'PrestaShop 1042: 2 x kubek, 79,98 zł', tone: 'warning', result: 'Bez gratisu. "Torba prezentowa" wydała już cały limit 50 szt. i wstrzymała się sama.' },
];

interface ComposerSeed {
  promo: Promotion;
  template: Template;
  isNew?: boolean;
  moreOpen?: boolean;
  test?: string;
  edited?: boolean;
  readOnly?: boolean;
}

function Composer({ seed }: { seed: ComposerSeed }): ReactElement {
  const { go } = useProto();
  const { showToast } = useToast();
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !seed.readOnly;
  const reason = seed.readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;
  const p = seed.promo;
  const [channels, setChannels] = useState<ChannelId[]>(p.channels);
  const [stackable, setStackable] = useState(p.stackable);
  const [skip, setSkip] = useState(seed.isNew ? true : p.skipIfPresent);
  const [perN, setPerN] = useState(String(p.perN));
  const [maxPerOrder, setMaxPerOrder] = useState(p.maxPerOrder ? String(p.maxPerOrder) : '');
  const [unitCap, setUnitCap] = useState(p.unitCap ? String(p.unitCap) : '');
  const [perCustomer, setPerCustomer] = useState(p.perCustomerLimit ? String(p.perCustomerLimit) : '');
  const [testId, setTestId] = useState(seed.test ?? 'o1');
  const test = TEST_ORDERS.find((t) => t.id === testId) ?? TEST_ORDERS[0];
  const gift = VARIANTS[p.gift];

  const summary = [
    stackable ? 'łączy się z innymi' : 'nie łączy się z innymi',
    seed.template === 'unit' ? `1 gratis na ${perN} szt.${maxPerOrder ? `, maks. ${maxPerOrder}` : ''}` : null,
    unitCap ? `limit ${unitCap} szt.` : 'do wyczerpania stanu',
    perCustomer ? `${perCustomer} na klienta` : null,
    skip ? 'pomija, gdy produkt już jest w zamówieniu' : null,
  ].filter(Boolean).join(' · ');

  const toast = (d: string): void => showToast({ tone: 'success', description: d });
  const primary = ((): { label: string; done: string } => {
    if (seed.isNew || p.status === 'draft') return { label: 'Włącz promocję', done: 'Włączono promocję.' };
    if (p.status === 'ended') return { label: 'Przedłuż i wznów', done: 'Przedłużono i wznowiono promocję.' };
    if (p.status === 'limit-reached') return { label: 'Podnieś limit i wznów', done: 'Podniesiono limit i wznowiono promocję.' };
    if (p.status === 'paused' || p.status === 'out-of-stock') return { label: 'Wznów', done: 'Wznowiono promocję.' };
    return { label: 'Zapisz zmiany', done: 'Zapisano zmiany.' };
  })();

  return (
    <PageLayout
      eyebrow="Promocje z gratisem"
      title={seed.isNew ? TEMPLATES.find((t) => t.id === seed.template)?.title ?? 'Nowa promocja' : p.name}
      actions={
        <div className="cfg-row">
          {!seed.isNew ? <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Skopiowano promocję jako szkic.')}>Kopiuj</Button> : null}
          {p.status === 'active' && !seed.isNew ? <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Wstrzymano promocję.')}>Wstrzymaj</Button> : null}
          <Button tone="primary" disabled={!canWrite} title={reason} onClick={() => toast(primary.done)}>{primary.label}</Button>
        </div>
      }
    >
      {p.status === 'out-of-stock' ? (
        <Alert tone="warning" title="Wstrzymała się sama: gratisu brak na stanie">
          {shortName(p.gift)} skończyła się 2 lis. Zamówienia idą dalej bez gratisu, z uwagą na zamówieniu. Promocja wznowi się sama, gdy produkt wróci na stan.
        </Alert>
      ) : null}
      {p.status === 'limit-reached' ? (
        <Alert tone="warning" title="Wstrzymała się sama: limit sztuk wyczerpany">Wydano {p.given} z {p.unitCap} szt. Podnieś limit, żeby wznowić.</Alert>
      ) : null}
      {p.status === 'ended' ? (
        <Alert tone="info" density="compact" title="Zakończona 31.10.2026">Możesz ją przedłużyć albo skopiować. Zamówienia, które dostały gratis, mają zapisane warunki z dnia zamówienia.</Alert>
      ) : null}
      {seed.edited ? (
        <Alert tone="info" density="compact" title="Zmiana działa od teraz">{p.openOrdersOnOldVersion} otwarte zamówienia dostały gratis na starych warunkach i tak zostanie.</Alert>
      ) : null}
      {seed.readOnly ? <Alert tone="info" density="compact" title="Tylko do odczytu">Widzisz ustawienia promocji, ale nie zmienisz ich.</Alert> : null}

      <div className="cfg-split cfg-split--aside">
        <div className="cfg-stack">
          <DetailSection title="Kiedy">
            <div className="v1-form-grid">
              {seed.template === 'basket' ? (
                <FormField label="Zamówienie od" name="min-basket" description="Liczy się kwota, którą zapłacił klient, bez dostawy.">
                  <Input defaultValue={p.minBasket ? (p.minBasket / 100).toFixed(2).replace('.', ',') : '150,00'} inputMode="decimal" disabled={!canWrite} />
                </FormField>
              ) : (
                <FormField label={seed.template === 'unit' ? 'Za każdą sztukę produktu' : 'Gdy zamówienie zawiera'} name="condition" description="Wpisz nazwę lub SKU produktu albo zestawu.">
                  <Input type="search" defaultValue={nameOfSku(p.containsSku) || 'Zestaw poranny'} disabled={!canWrite} />
                </FormField>
              )}
              <FormField label="Okres" name="period" description="Liczy się data złożenia zamówienia. Promocja nie działa wstecz.">
                <span className="cfg-row">
                  <Input type="date" defaultValue={p.from} aria-label="Od" disabled={!canWrite} />
                  <Input type="date" defaultValue={p.to} aria-label="Do" disabled={!canWrite} />
                </span>
              </FormField>
            </div>
          </DetailSection>

          <DetailSection title="Gratis">
            <div className="v1-form-grid">
              <FormField label="Produkt" name="gift" description={gift.cost === null ? 'Brak kosztu zakupu: promocję włączysz, w raporcie koszt będzie pusty.' : undefined}>
                <Input type="search" defaultValue={gift.name} disabled={!canWrite} />
              </FormField>
              <FormField label="Ilość" name="gift-qty"><Input type="number" min={1} defaultValue={p.giftQty} disabled={!canWrite} /></FormField>
            </div>
            <WhoPaysStrip qty={p.giftQty} unitCost={gift.cost} />
          </DetailSection>

          <DetailSection title="Kanały">
            <FilterChecks aria-label="Kanały">
              {ALL_CHANNELS.map((c) => (
                <FilterCheck
                  key={c}
                  label={<span className="v1-chan">{CHANNELS[c].name}{channels.includes(c) ? <span className="cfg-muted"> · {channelMarker(c)}</span> : null}</span>}
                  checked={channels.includes(c)}
                  disabled={!canWrite}
                  onChange={(e) => setChannels((cs) => (e.target.checked ? [...cs, c] : cs.filter((x) => x !== c)))}
                />
              ))}
            </FilterChecks>
            {channels.includes('prestashop') ? (
              <p className="cfg-muted">Jeśli w PrestaShop masz regułę koszyka z tym samym gratisem, zostaw jedną z nich, żeby klient nie dostał dwóch.</p>
            ) : null}
          </DetailSection>

          <InlineDisclosure label="Więcej opcji" value={summary} changeLabel="Zmień" defaultOpen={seed.moreOpen}>
            <div className="cfg-stack cfg-stack--tight">
              <Switch checked={!stackable} onChange={(v) => setStackable(!v)} disabled={!canWrite} hint={reason} label="Nie łącz z innymi promocjami" />
              <Switch checked={skip} onChange={setSkip} disabled={!canWrite} hint={reason} label="Pomiń, jeśli produkt jest już w zamówieniu (także jako składnik zestawu)" />
              {seed.template === 'unit' ? (
                <div className="v1-form-grid">
                  <FormField label="1 gratis na każde" name="per-n" description="sztuk produktu"><Input type="number" min={1} value={perN} onChange={(e) => setPerN(e.target.value)} disabled={!canWrite} /></FormField>
                  <FormField label="Maks. na zamówienie" name="max-order" description="puste = bez limitu"><Input type="number" min={1} value={maxPerOrder} onChange={(e) => setMaxPerOrder(e.target.value)} disabled={!canWrite} /></FormField>
                </div>
              ) : null}
              <div className="v1-form-grid">
                <FormField label="Limit sztuk w całej promocji" name="unit-cap" description="Puste = do wyczerpania stanu. Po limicie promocja wstrzyma się sama."><Input type="number" min={1} value={unitCap} onChange={(e) => setUnitCap(e.target.value)} disabled={!canWrite} /></FormField>
                <FormField label="Limit na klienta" name="per-customer" description="Opcjonalnie. Liczony po koncie klienta w kanale, nie po e-mailu."><Input type="number" min={1} value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} disabled={!canWrite} /></FormField>
              </div>
              <p className="cfg-muted">Gdy gratisu zabraknie, promocja wstrzyma się sama, a zamówienia pójdą dalej z uwagą.</p>
            </div>
          </InlineDisclosure>
        </div>

        <DetailSection title="Sprawdź na zamówieniu">
          <FormField label="Przykładowe zamówienie" name="test-order">
            <Select value={testId} onChange={(e) => setTestId(e.target.value)}>
              {TEST_ORDERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </FormField>
          <div className="v1-test" aria-live="polite">
            <StatusBadge tone={test.tone} compact withDot>{test.tone === 'success' ? 'Dostanie gratis' : 'Bez gratisu'}</StatusBadge>
            <p className="cfg-secondary">{test.result}</p>
          </div>
          <button type="button" className="cfg-link" onClick={() => go('promotions', 'list')}>Wróć do listy</button>
        </DetailSection>
      </div>
    </PageLayout>
  );
}

const COMPOSER: Record<string, ComposerSeed> = {
  'composer-product': { promo: { ...byId('promo-spoon'), status: 'draft', given: 0 }, template: 'product', isNew: true },
  'composer-basket': { promo: byId('promo-xmas'), template: 'basket' },
  'composer-per-unit': { promo: { ...byId('promo-bag'), status: 'draft', perUnit: true, perN: 2, maxPerOrder: 3, given: 0 }, template: 'unit', isNew: true, moreOpen: true },
  'more-options': { promo: byId('promo-spoon'), template: 'product', moreOpen: true },
  active: { promo: byId('promo-spoon'), template: 'product' },
  'paused-out-of-stock': { promo: byId('promo-sample'), template: 'basket', test: 'o3' },
  'limit-reached': { promo: byId('promo-bag'), template: 'product', test: 'o2' },
  ended: { promo: byId('promo-oct'), template: 'basket' },
  'edited-open-orders': { promo: byId('promo-spoon'), template: 'product', edited: true },
  'gift-no-cost': { promo: NO_COST_PROMO, template: 'basket' },
  'test-two-match': { promo: byId('promo-spoon'), template: 'product', test: 'o1' },
  'test-skip-if-present': { promo: byId('promo-spoon'), template: 'product', test: 'o4', moreOpen: true },
  'test-customer-limit': { promo: byId('promo-sample'), template: 'basket', test: 'o3', moreOpen: true },
};

function Screen({ state }: { state: string }): ReactElement {
  if (state === 'new-template') return <TemplatePicker />;
  const seed = COMPOSER[state];
  if (seed) return <Composer seed={seed} />;
  return <PromoList readOnly={state === 'viewer-readonly'} />;
}

export const screen: ScreenDef = {
  id: 'promotions',
  group: 'Sprzedaż',
  label: 'Promocje z gratisem',
  states: [
    { id: 'list', label: 'Lista promocji', note: 'Promocje w kolejności sprawdzania, z przyciskami Wyżej i Niżej. Wiersz: nazwa, jedna linia warunków, jeden stan z powodem i liczba wydanych sztuk. Pod spodem: OpenLinker dodaje gratis do zamówienia przy przyjęciu; integracja kanału odczytuje gratisy, które kanał zna sam.', useCases: ['G-06', 'G-12'], priority: 'pilot' },
    { id: 'new-template', label: 'Nowa promocja: wybór', note: 'Start od trzech kart zamiast pustego formularza, jak szablony w BOGOS. Każda karta otwiera formularz z gotowymi polami.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'composer-product', label: 'Gratis do produktu', note: 'Cztery pola: kiedy, gratis, kanały, okres. "Pomiń, jeśli produkt już jest w zamówieniu" jest domyślnie włączone. Przy kanale jeden znacznik: natywnie w kanale albo przez OpenLinker.', useCases: ['G-04', 'G-06'], priority: 'pilot' },
    { id: 'composer-basket', label: 'Gratis od kwoty', note: 'Warunek to kwota zamówienia. Reszta pól jak przy produkcie.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'composer-per-unit', label: 'Gratis do każdej sztuki', note: '"1 gratis na N sztuk" i maks. na zamówienie są w "Więcej opcji". Decyzja: Cin7 i Mirakl mają taki mnożnik z limitem.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'more-options', label: 'Więcej opcji', note: 'Wszystko poza czterema polami jest tu, z podsumowaniem w jednej linii: nie łącz, limit sztuk, limit na klienta, pomiń gdy produkt już jest. Decyzja: limit w sztukach i stop przy braku stanu zamiast budżetu w złotówkach, jak BaseLinker, Apilo, Sellasist.', useCases: ['G-06', 'G-15'], priority: 'pilot' },
    { id: 'active', label: 'Aktywna', note: 'Aktywna promocja otwiera się w tym samym formularzu. "Kopiuj" robi szkic, "Wstrzymaj" zatrzymuje dodawanie gratisu.', useCases: ['G-06', 'G-04'], priority: 'pilot' },
    { id: 'paused-out-of-stock', label: 'Wstrzymała się sama: brak gratisu', note: 'Bez wyboru, co robić przy braku: promocja sama się wstrzymuje, zamówienia idą dalej z uwagą, a po dostawie promocja wznawia się sama. Decyzja: Sellasist blokuje akcję przy braku stanu, BOGOS ma tylko stop albo dalej.', useCases: ['G-08', 'G-16'], priority: 'pilot' },
    { id: 'limit-reached', label: 'Wstrzymała się sama: limit', note: 'Limit sztuk wyczerpany. Jeden przycisk: "Podnieś limit i wznów".', useCases: ['G-06', 'G-08'], priority: 'pilot' },
    { id: 'ended', label: 'Zakończona', note: 'Zakończoną promocję można przedłużyć albo skopiować. Zamówienia mają zapisane warunki z dnia zamówienia, więc edycja nie zmienia historii.', useCases: ['G-12'], priority: 'pilot' },
    { id: 'edited-open-orders', label: 'Zmiana przy otwartych zamówieniach', note: 'Jedno zdanie: zmiana działa od teraz, otwarte zamówienia zostają przy swoich warunkach. Bez numerów wersji.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'gift-no-cost', label: 'Gratis bez kosztu zakupu', note: 'Promocję można włączyć. Pasek kosztu mówi "koszt nieznany", a w raporcie koszt będzie pusty, aż uzupełnisz koszt zakupu.', useCases: ['G-12', 'G-06'], priority: 'pilot' },
    { id: 'test-two-match', label: 'Test: pasują 2 promocje', note: 'Wynik testu jednym zdaniem: wygrywa promocja wyżej na liście, bo nie łączy się z innymi.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'test-skip-if-present', label: 'Test: produkt już w zamówieniu', note: 'Łyżeczka jest już składnikiem zestawu, więc promocja jej nie doda. Decyzja: na Allegro gratis sprzedaje się jako składnik zestawu, dlatego ta opcja jest domyślnie włączona.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'test-customer-limit', label: 'Test: limit na klienta', note: 'Kupujący dostał już gratis z tej promocji. Klienta rozpoznajemy po koncie w kanale, bo Allegro daje inny e-mail przy każdym zamówieniu.', useCases: ['G-15'], priority: 'later' },
    { id: 'viewer-readonly', label: 'Tylko do odczytu', note: 'Użytkownik bez uprawnień widzi listę i stany promocji. Przyciski są wyłączone z powodem.', useCases: ['G-06'], priority: 'pilot' },
    ...commonStates('promocji', 'Utwórz promocję'),
  ],
  render: (state) => <Screen state={state} />,
};
