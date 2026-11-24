/**
 * v1 returns, simple version: one table of what comes back, one amount field,
 * one line "Według wzoru Allegro: X. Użyj". The calculation hides under
 * "Pokaż wyliczenie"; nothing is deducted automatically.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, VARIANTS } from '../model/catalog';
import { commonStates, useMoney, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, GiftMark } from '../ui/marks';
import { GIFT_ORDER, shareOf } from './doc-returns-data';
import { VariantPicker } from './v1-order';
import './v1-ops.css';

/* ── Data ──────────────────────────────────────────────────────────── */

interface RLine {
  id: string;
  name: string;
  sku: string;
  image?: string;
  qty: number;
  role?: 'bundle' | 'component' | 'gift';
  state: { label: string; tone: StatusBadgeTone };
}

const BACK = { label: 'Wrócił do magazynu', tone: 'info' as const };
const KEPT = { label: 'Zostaje u klienta', tone: 'neutral' as const };
const STOCKED = { label: 'Przyjęty na stan', tone: 'success' as const };
const CHECK = { label: 'Do sprawdzenia', tone: 'warning' as const };

const variantLine = (key: string, qty: number, state: RLine['state'], role?: RLine['role']): RLine => ({ id: key, name: VARIANTS[key].name, sku: VARIANTS[key].sku, image: VARIANTS[key].image, qty, role, state });
const morningHeader = (state: RLine['state']): RLine => ({ id: 'set', name: BUNDLES.morning.name, sku: BUNDLES.morning.sku, image: BUNDLES.morning.image, qty: 1, role: 'bundle', state });

const ORDER_NO = 'Allegro 8812-4410-0921';
const PAID_SET = BUNDLES.morning.price;
const ALLEGRO_HINT = PAID_SET - VARIANTS.mug.price; // paid for the set minus full price of what is kept (mug); the gift spoon does not count

/* ── Pieces ────────────────────────────────────────────────────────── */

function parse(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
const toInput = (g: number): string => (g / 100).toFixed(2).replace('.', ',');

function Lines({ lines }: { lines: RLine[] }): ReactElement {
  const columns: DataTableColumn<RLine>[] = [
    {
      id: 'item',
      header: 'Pozycja',
      lines: 2,
      cell: (l) => (
        <div className={`v1o-item${l.role === 'component' || (l.role === 'gift' && lines.some((x) => x.role === 'bundle')) ? ' v1o-item--child' : ''}`}>
          <ProductThumbnail name={l.name} src={l.image} size="sm" />
          <div className="v1o-item__body">
            <span className={`v1o-item__name${l.role === 'bundle' ? ' v1o-item__name--bundle' : ''}`}>
              {l.role === 'bundle' ? <BundleMark compact /> : null}
              {l.role === 'gift' ? <GiftMark compact /> : null}
              <span>{l.name}</span>
            </span>
            <span className="v1o-item__sku">{l.sku}</span>
          </div>
        </div>
      ),
    },
    { id: 'qty', header: 'Ilość', align: 'right', cell: (l) => <span className="tabular">{l.qty}</span> },
    { id: 'state', header: 'Towar', cell: (l) => (l.role === 'bundle' ? null : <StatusBadge tone={l.state.tone} compact withDot>{l.state.label}</StatusBadge>) },
  ];
  return <DataTable caption="Co wraca" columns={columns} rows={lines} rowKey={(l) => l.id} />;
}

interface AmountProps {
  initial: number | null;
  hint?: { amount: number; rows: { label: string; value: string }[] };
  max: number;
  readOnly?: boolean;
  note?: ReactNode;
}

function RefundAmount({ initial, hint, max, readOnly, note }: AmountProps): ReactElement {
  const money = useMoney();
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !readOnly;
  const reason = readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;
  const { showToast } = useToast();
  const [value, setValue] = useState(initial === null ? '' : toInput(initial));
  const [showCalc, setShowCalc] = useState(false);
  const parsed = parse(value);
  const tooHigh = parsed !== null && parsed > max;
  const invalid = parsed === null || tooHigh;
  return (
    <DetailSection title="Zwrot pieniędzy">
      <div className="v1o-amount">
        <FormField
          label="Kwota zwrotu"
          name="v1-refund"
          description={tooHigh ? `Kwota nie może być wyższa niż zapłacona: ${money(max, 'PLN')}.` : 'Kwota trafi do zwrotu w Allegro. Możesz ją zmienić.'}
        >
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canWrite} aria-invalid={tooHigh || undefined} />
        </FormField>
        {hint ? (
          <div className="v1o-hint">
            <span>
              Według wzoru Allegro: <strong>{money(hint.amount, 'PLN')}</strong>
            </span>
            <Button tone="ghost" className="button--sm" disabled={!canWrite} title={reason} onClick={() => setValue(toInput(hint.amount))}>
              Użyj
            </Button>
            <button type="button" className="v1o-link" aria-expanded={showCalc} onClick={() => setShowCalc(!showCalc)}>
              {showCalc ? 'Ukryj wyliczenie' : 'Pokaż wyliczenie'}
            </button>
          </div>
        ) : null}
        {hint && showCalc ? <KeyValueList items={hint.rows.map((r, i) => ({ id: String(i), label: r.label, value: <span className="tabular">{r.value}</span> }))} /> : null}
        {note}
        <div>
          <Button
            tone="primary"
            disabled={!canWrite || invalid}
            title={!canWrite ? reason : invalid ? 'Wpisz poprawną kwotę' : undefined}
            onClick={() => showToast({ tone: 'success', title: 'Zapisano kwotę zwrotu', description: `${money(parsed ?? 0, 'PLN')} do zwrotu w Allegro.` })}
          >
            Zapisz kwotę zwrotu
          </Button>
        </div>
      </div>
    </DetailSection>
  );
}

function ReturnPage({ number = ORDER_NO, reasonText, banner, children }: { number?: string; reasonText: string; banner?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <PageLayout eyebrow="Zwrot" title={`Zwrot do zamówienia ${number}`} description={`Allegro · zgłoszono 4 lis 2026 · ${reasonText}`}>
      <div className="v1o-stack">
        {banner}
        {children}
      </div>
    </PageLayout>
  );
}

/* ── States ────────────────────────────────────────────────────────── */

type BundleVariant = 'whole' | 'one' | 'old';

function BundleReturn({ initial = 'one', readOnly }: { initial?: BundleVariant; readOnly?: boolean }): ReactElement {
  const money = useMoney();
  const [w, setW] = useState<BundleVariant>(initial);
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !readOnly;
  const { showToast } = useToast();
  const [stocked, setStocked] = useState(false);
  const hintRows = [
    { label: 'Zapłacono za zestaw', value: money(PAID_SET, 'PLN') },
    { label: 'Kubek zostaje u klienta, pełna cena', value: `-${money(VARIANTS.mug.price, 'PLN')}` },
    { label: 'Łyżeczka to gratis, nie liczy się', value: money(0, 'PLN') },
    { label: 'Według wzoru Allegro', value: money(ALLEGRO_HINT, 'PLN') },
    { label: 'Dla porównania: kawa na fakturze', value: money(shareOf('coffee'), 'PLN') },
  ];
  const whole = w === 'whole';
  const back = stocked ? STOCKED : BACK;
  const lines = whole
    ? [morningHeader(back), variantLine('mug', 1, back, 'component'), variantLine('coffee', 1, back, 'component'), variantLine('spoon', 1, back, 'gift')]
    : [morningHeader(back), variantLine('mug', 1, KEPT, 'component'), variantLine('coffee', 1, back, 'component'), variantLine('spoon', 1, KEPT, 'gift')];
  return (
    <div className="v1o-stack">
      {!readOnly ? (
        <VariantPicker
          value={w}
          onChange={(n) => { setW(n); setStocked(false); }}
          options={[
            { value: 'one', label: 'Wraca jeden składnik' },
            { value: 'whole', label: 'Wraca cały zestaw' },
            { value: 'old', label: 'Stare zamówienie, bez zapisanego podziału' },
          ]}
        />
      ) : null}
      <ReturnPage key={w} reasonText={whole ? 'powód: odstąpienie od umowy' : 'powód: kawa nie smakowała'}>
        <DetailSection
          title="Co wraca"
          titleAside={
            <Button tone="secondary" className="button--sm" disabled={!canWrite || stocked} title={!canWrite ? guard.reason : undefined} onClick={() => { setStocked(true); showToast({ tone: 'success', title: 'Przyjęto na stan', description: whole ? 'Kubek +1, kawa +1, łyżeczka +1 w PrestaShop.' : 'Kawa +1 w PrestaShop.' }); }}>
              Przyjmij na stan
            </Button>
          }
        >
          <Lines lines={lines} />
        </DetailSection>
        <RefundAmount
          initial={whole ? PAID_SET : w === 'one' ? shareOf('coffee') : null}
          max={PAID_SET}
          readOnly={readOnly}
          hint={whole ? undefined : { amount: ALLEGRO_HINT, rows: w === 'old' ? hintRows.slice(0, 4) : hintRows }}
          note={w === 'old' ? <p className="v1o-item__note">To zamówienie jest sprzed zapisywania podziału ceny zestawu, więc kwota nie podpowiada się sama. Wpisz ją albo użyj wzoru Allegro.</p> : null}
        />
      </ReturnPage>
    </div>
  );
}

type GiftChoice = 'keep' | 'ask' | 'deduct';

function GiftReturn({ initial = 'keep' }: { initial?: GiftChoice }): ReactElement {
  const money = useMoney();
  const { canWrite, reason } = useWriteGuard();
  const [c, setC] = useState<GiftChoice>(initial);
  const sample = GIFT_ORDER.sample;
  const refund = c === 'deduct' ? VARIANTS.mug.price - sample.price : VARIANTS.mug.price;
  const lines = [variantLine('mug', 1, BACK), variantLine('sample', 1, c === 'ask' ? BACK : KEPT, 'gift')];
  return (
    <ReturnPage
      number={GIFT_ORDER.number}
      reasonText="powód: odstąpienie od umowy"
      banner={
        <Alert tone="info" title="Po zwrocie koszyk spadł poniżej progu promocji">
          Bez kubka zamówienie ma {money(GIFT_ORDER.press + VARIANTS.mug.price, 'PLN')}, a próg gratisu to {money(GIFT_ORDER.threshold, 'PLN')}. OpenLinker nic nie potrąca sam. Zdecyduj, co z gratisem.
        </Alert>
      }
    >
      <DetailSection title="Co wraca">
        <Lines lines={lines} />
      </DetailSection>
      <DetailSection title="Co z gratisem">
        <div className="v1o-stack">
          <SegmentedControl
            aria-label="Co z gratisem"
            value={c}
            onChange={(n) => { if (canWrite) setC(n); }}
            options={[
              { value: 'keep', label: 'Zostaw u klienta' },
              { value: 'ask', label: 'Gratis wrócił' },
              { value: 'deduct', label: 'Potrąć wartość' },
            ]}
            aria-disabled={!canWrite || undefined}
            title={reason}
          />
          <p className="v1o-item__note">
            {c === 'keep'
              ? 'Klient zatrzymuje próbkę. Najczęstszy wybór przy tanim gratisie.'
              : c === 'ask'
                ? 'Próbka wróciła razem z kubkiem. Przyjmiesz ją na stan jak każdy towar.'
                : `Potrącisz ${money(sample.price, 'PLN')}, czyli cenę próbki. Zrób to tylko, gdy regulamin oferty o tym mówi.`}
          </p>
        </div>
      </DetailSection>
      <RefundAmount key={c} initial={refund} max={VARIANTS.mug.price} />
    </ReturnPage>
  );
}

type Match = 'allegro' | 'erli';

function MatchLine({ initial = 'allegro' }: { initial?: Match }): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const money = useMoney();
  const [m, setM] = useState<Match>(initial);
  const [pick, setPick] = useState(initial === 'allegro' ? 'L1' : '');
  const [done, setDone] = useState(false);
  const options =
    m === 'allegro'
      ? [
          { value: 'L1', label: `Kubek, ${money(VARIANTS.mug.price, 'PLN')} (podpowiedź: bez rabatu za pakiet)` },
          { value: 'L2', label: `Kubek, ${money(VARIANTS.mug.price - 500, 'PLN')} (w pakiecie ofert)` },
        ]
      : [
          { value: 'L1', label: 'Pozycja 1: Kubek ceramiczny 350 ml, biały' },
          { value: 'L2', label: 'Pozycja 2: Kawa ziarnista Etiopia 250 g' },
        ];
  return (
    <div className="v1o-stack">
      <VariantPicker value={m} onChange={(n) => { setM(n); setPick(n === 'allegro' ? 'L1' : ''); setDone(false); }} options={[{ value: 'allegro', label: 'Allegro: ta sama oferta 2 razy' }, { value: 'erli', label: 'Erli: zła pozycja' }]} />
      <ReturnPage
        key={m}
        number={m === 'allegro' ? ORDER_NO : 'ERL-55301'}
        reasonText="powód: uszkodzony"
        banner={
          done ? (
            <Alert tone="success" title="Dopasowanie potwierdzone">Zwrot przypisano do wybranej pozycji. Kwota zwrotu podpowie się z jej ceny.</Alert>
          ) : (
            <Alert tone="warning" title={m === 'allegro' ? 'Kubek jest w zamówieniu 2 razy' : 'Erli wskazało pozycję, której nie ma'}>
              {m === 'allegro'
                ? 'Jedna sztuka ma rabat za pakiet ofert, druga nie. OpenLinker podpowiada pozycję bez rabatu. Sprawdź i potwierdź.'
                : 'Zwrot dotyczy pozycji nr 3, a zamówienie ma 2. Wybierz pozycję ręcznie.'}
            </Alert>
          )
        }
      >
        <DetailSection title="Której pozycji dotyczy zwrot">
          <div className="v1o-amount">
            <FormField label="Pozycja zamówienia" name="v1-match">
              <Select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!canWrite || done}>
                {m === 'erli' ? <option value="">Wybierz pozycję</option> : null}
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </FormField>
            <div>
              <Button tone="primary" disabled={!canWrite || !pick || done} title={!canWrite ? reason : !pick ? 'Wybierz pozycję' : undefined} onClick={() => { setDone(true); showToast({ tone: 'success', title: 'Potwierdzono dopasowanie', description: 'Zwrot przypisano do pozycji.' }); }}>
                Potwierdź dopasowanie
              </Button>
            </div>
          </div>
        </DetailSection>
        <DetailSection title="Co wraca">
          <Lines lines={[{ ...variantLine(m === 'allegro' ? 'mug' : 'mug', 1, done ? BACK : CHECK) }]} />
        </DetailSection>
      </ReturnPage>
    </div>
  );
}

function CorrectionInvoice(): ReactElement {
  const money = useMoney();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [issued, setIssued] = useState(false);
  const coffee = shareOf('coffee');
  return (
    <ReturnPage
      reasonText="powód: kawa nie smakowała"
      banner={issued ? <Alert tone="success" title="Wystawiono korektę FK/2026/11/0031">Korekta trafiła do KSeF.</Alert> : null}
    >
      <DetailSection
        title="Faktura korygująca"
        titleAside={
          <Button tone="primary" className="button--sm" disabled={!canWrite || issued} title={reason} onClick={() => { setIssued(true); showToast({ tone: 'success', title: 'Wystawiono korektę', description: `FK/2026/11/0031, ${money(-coffee, 'PLN')}.` }); }}>
            Wystaw korektę
          </Button>
        }
      >
        <KeyValueList
          items={[
            { id: 'inv', label: 'Do faktury', value: 'FV/2026/11/0412' },
            { id: 'line', label: 'Pozycja', value: `Kawa ziarnista Etiopia 250 g (z zestawu), -1 x ${money(coffee, 'PLN')}` },
            { id: 'vat', label: 'Stawka VAT', value: '5%' },
            { id: 'sum', label: 'Razem korekta', value: <strong className="tabular">{money(-coffee, 'PLN')}</strong> },
          ]}
        />
        <p className="v1o-item__note">Wartość kawy pochodzi z podziału ceny zapisanego w dniu sprzedaży. Jeśli zwróciłeś klientowi kwotę według wzoru Allegro, różnica zostaje jako utracony rabat zestawu.</p>
      </DetailSection>
    </ReturnPage>
  );
}

function PackRestockBlocked(): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  const back = done ? STOCKED : BACK;
  return (
    <ReturnPage
      number="Allegro 8812-6610-2204"
      reasonText="powód: odstąpienie od umowy"
      banner={
        done ? (
          <Alert tone="success" title="Przyjęto składniki na stan">French press +1, kawa +2 w PrestaShop.</Alert>
        ) : (
          <Alert
            tone="warning"
            title="PrestaShop nie przyjmie zestawu na stan sam"
            action={
              <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => { setDone(true); showToast({ tone: 'success', title: 'Przyjęto na stan', description: 'French press +1, kawa +2 w PrestaShop.' }); }}>
                Przyjmij składniki na stan
              </Button>
            }
          >
            W PrestaShop "Zestaw do parzenia" jest pakiem z własnym stanem. OpenLinker nie zgaduje, czy zwiększyć stan paka, czy składników. Przyjmij składniki jednym kliknięciem.
          </Alert>
        )
      }
    >
      <DetailSection title="Co wraca">
        <Lines lines={[{ id: 'set', name: BUNDLES.brew.name, sku: BUNDLES.brew.sku, image: BUNDLES.brew.image, qty: 1, role: 'bundle', state: back }, variantLine('press', 1, back, 'component'), variantLine('coffee', 2, back, 'component')]} />
      </DetailSection>
    </ReturnPage>
  );
}

/* ── Registry ──────────────────────────────────────────────────────── */

const STATES: StateDef[] = [
  { id: 'bundle', label: 'Zwrot zestawu', note: 'Jedna tabela i jedno pole kwoty. Gdy wraca jeden składnik, pod polem jest linia "Według wzoru Allegro: 25,00 zł" z przyciskiem "Użyj"; wyliczenie jest pod "Pokaż wyliczenie". Nic nie dzieje się samo. Wariant "stare zamówienie" nie ma zapisanego podziału ceny, więc kwotę wpisujesz, a wzór Allegro nadal pomaga. Pod spodem: integracja Allegro przyjmuje kwotę zwrotu, OpenLinker tylko ją podpowiada.', useCases: ['R-01', 'B-15', 'R-02', 'R-05'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift', label: 'Gratis przy zwrocie', note: 'Po zwrocie koszyk spadł poniżej progu promocji. OpenLinker nigdy nie potrąca gratisu sam. Trzy wybory w jednym przełączniku: zostaw u klienta, gratis wrócił, potrąć wartość. Kwota zwrotu przelicza się od razu.', useCases: ['G-11'], priority: 'pilot', channels: ['allegro'] },
  { id: 'match-line', label: 'Dopasowanie pozycji', note: 'Allegro: ten sam kubek jest w zamówieniu 2 razy, raz z rabatem za pakiet ofert. OpenLinker podpowiada pozycję bez rabatu, operator potwierdza. Erli: zwrot wskazuje pozycję, której nie ma, więc wybór jest ręczny.', useCases: ['R-03', 'R-04', 'B-07'], priority: 'pilot', channels: ['allegro', 'erli'] },
  { id: 'correction-invoice', label: 'Faktura korygująca', note: 'Korekta jednego składnika zestawu z wartością z podziału zapisanego w dniu sprzedaży. Pod spodem: integracja dostawcy faktur wystawia korektę w swoim formacie.', useCases: ['B-15', 'R-05'], priority: 'pilot', channels: ['allegro'] },
  { id: 'pack-restock-blocked', label: 'Pak PrestaShop przy zwrocie', note: 'PrestaShop ma ten zestaw jako pak z własnym stanem. OpenLinker nie zgaduje i daje jeden przycisk: przyjmij składniki. Pod spodem: zapis stanu robi integracja PrestaShop.', useCases: ['R-06'], priority: 'later', channels: ['prestashop'] },
  { id: 'viewer', label: 'Tylko do odczytu', note: 'Bez uprawnień widać tabelę, kwotę i podpowiedź, ale pole i przyciski są wyłączone z powodem w podpowiedzi.', useCases: [], priority: 'pilot' },
  ...commonStates('zwrotów', 'zwroty pojawią się, gdy kanał je zgłosi'),
];

function render(state: string): ReactElement {
  switch (state) {
    case 'bundle':
    case 'bundle-one-component':
      return <BundleReturn />;
    case 'bundle-whole-line':
      return <BundleReturn initial="whole" />;
    case 'bundle-no-frozen-price':
      return <BundleReturn initial="old" />;
    case 'gift':
    case 'gift-kept':
      return <GiftReturn />;
    case 'gift-returned':
      return <GiftReturn initial="ask" />;
    case 'gift-deducted':
      return <GiftReturn initial="deduct" />;
    case 'match-line':
    case 'allegro-duplicate-lines':
      return <MatchLine />;
    case 'erli-index-mismatch':
      return <MatchLine initial="erli" />;
    case 'correction-invoice':
      return <CorrectionInvoice />;
    case 'pack-restock-blocked':
      return <PackRestockBlocked />;
    case 'viewer':
      return <BundleReturn readOnly />;
    default:
      return <BundleReturn />;
  }
}

export const screen: ScreenDef = {
  id: 'returns',
  group: 'Sprzedaż',
  label: 'Zwroty',
  states: STATES,
  render,
};
