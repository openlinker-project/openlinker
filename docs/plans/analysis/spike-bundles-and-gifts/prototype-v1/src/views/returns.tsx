/**
 * Returns (plan item 10): return detail screens for bundles and gifts. The lines
 * table follows ReturnLinesTable (same columns, card view and responsive drops);
 * the real component carries English copy, so the look is rebuilt in Polish.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { KeyValueList, type KeyValueItem } from '@web/shared/ui/key-value-list';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { FormField } from '@web/shared/ui/form-field';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web/shared/ui/dialog';
import { useToast } from '@web/shared/ui/toast-provider';
import { VARIANTS } from '../model/catalog';
import { commonStates, EUR_RATE, Note, useMoney, useProto, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, ChannelPayload, GiftMark, PartOf, StockPathTrail, Switch, type TrailStep } from '../ui/marks';
import { InvoicePreview } from '../ui/documents';
import {
  BUNDLE_LINE_ID, CUSTODY_LABEL, GIFT_ORDER, LOST_DISCOUNT, MONEY_LABEL, MORNING_SPLIT, ORDER_ALLEGRO, correctionInvoice, originalInvoice, shareOf,
  type RetLine,
} from './doc-returns-data';
import './doc.css';

/* ── Money in the order's currency ────────────────────────────────── */

/** Formats PLN grosze in the order currency (EUR via EUR_RATE when the global switch says so). */
function useOrderMoney(): { show: (pln: number) => string; toInput: (pln: number) => string; fromInput: (s: string) => number | null; unit: string; eur: boolean } {
  const money = useMoney();
  const { currency } = useProto();
  const eur = currency === 'EUR';
  return {
    eur,
    unit: eur ? 'EUR' : 'zł',
    show: (pln) => (eur ? `${money(Math.round(pln / EUR_RATE), 'EUR')} (${money(pln, 'PLN')})` : money(pln, 'PLN')),
    toInput: (pln) => ((eur ? Math.round(pln / EUR_RATE) : pln) / 100).toFixed(2).replace('.', ','),
    fromInput: (s) => {
      const n = Number(s.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return null;
      const minor = Math.round(n * 100);
      return eur ? Math.round(minor * EUR_RATE) : minor;
    },
  };
}

/* ── Lines table (ReturnLinesTable look) ──────────────────────────── */

function ItemCell({ line, wide }: { line: RetLine; wide?: boolean }): ReactElement {
  return (
    <span className={wide ? 'doc-ret-item doc-ret-item--wide' : 'doc-ret-item'}>
      <span>{line.name}</span>
      <span className="mono-text text-muted">{line.sku}</span>
      {line.role || line.partOf ? (
        <span className="doc-ret-item__marks">
          {line.role === 'bundle' ? <BundleMark compact /> : null}
          {line.role === 'gift' ? <GiftMark source={line.giftSource} /> : null}
          {line.partOf ? <PartOf bundle={line.partOf} /> : null}
        </span>
      ) : null}
    </span>
  );
}

function OrderLineCell({ line }: { line: RetLine }): ReactElement {
  if (line.orderLine === null) return <span className="text-muted" title="OpenLinker nie wie, do której pozycji zamówienia należy ta pozycja. Zwrot jest zapisany w całości.">Nie dopasowano do pozycji</span>;
  return (
    <span className="doc-ret-item">
      <span className="mono-text">{line.orderLine}</span>
      {line.orderLineNote ? <span className="spike-note">{line.orderLineNote}</span> : null}
    </span>
  );
}

const Custody = ({ line }: { line: RetLine }): ReactElement => <StatusBadge tone={CUSTODY_LABEL[line.custody].tone} compact withDot>{CUSTODY_LABEL[line.custody].label}</StatusBadge>;
const Money = ({ line }: { line: RetLine }): ReactElement => <StatusBadge tone={MONEY_LABEL[line.money].tone} compact>{MONEY_LABEL[line.money].label}</StatusBadge>;

function ReturnLines({ lines, renderDetail }: { lines: RetLine[]; renderDetail?: (l: RetLine) => ReactNode }): ReactElement {
  const columns = useMemo<DataTableColumn<RetLine>[]>(
    () => [
      { id: 'item', header: 'Pozycja', cell: (l) => <ItemCell line={l} wide /> },
      { id: 'advised', header: 'Zgłoszono', align: 'right', cell: (l) => <span className="tabular">{l.advised}</span> },
      { id: 'received', header: 'Przyjęto', align: 'right', cell: (l) => <span className="tabular">{l.received}</span> },
      { id: 'restocked', header: 'Na stan', align: 'right', cell: (l) => <span className="tabular">{l.restocked}</span>, hideBelow: 768 },
      { id: 'reason', header: 'Powód', cell: (l) => l.reason, hideBelow: 1024 },
      { id: 'custody', header: 'Towar', cell: (l) => <Custody line={l} />, hideBelow: 1024 },
      { id: 'money', header: 'Zwrot pieniędzy', cell: (l) => <Money line={l} />, hideBelow: 1024 },
      { id: 'orderLine', header: 'Pozycja zamówienia', cell: (l) => <OrderLineCell line={l} /> },
    ],
    [],
  );
  return (
    <DataTable
      caption="Zwrócone pozycje, w kolejności zgłoszonej przez kanał"
      columns={columns}
      rows={lines}
      rowKey={(l) => l.id}
      expandable={renderDetail ? { renderDetail, toggleLabel: (l, open) => `${open ? 'Zwiń' : 'Pokaż składniki'} ${l.name}` } : undefined}
      cardView={{
        title: (l) => l.name,
        subtitle: (l) => `${l.received} z ${l.advised} przyjęto`,
        detail: (l) => (
          <KeyValueList
            items={[
              ...(l.role || l.partOf ? [{ id: 'role', label: 'Rola', value: <ItemCell line={l} /> }] : []),
              { id: 'reason', label: 'Powód', value: l.reason },
              { id: 'custody', label: 'Towar', value: <Custody line={l} /> },
              { id: 'money', label: 'Zwrot pieniędzy', value: <Money line={l} /> },
              { id: 'orderLine', label: 'Pozycja zamówienia', value: <OrderLineCell line={l} /> },
            ]}
          />
        ),
      }}
    />
  );
}

/** The frozen expansion of the morning set, shown inside the bundle line. */
function FrozenExpansion(): ReactElement {
  const money = useMoney();
  return (
    <div className="doc-ret-detail">
      <span className="text-muted">Składniki zamrożone przy sprzedaży (wersja 2 zestawu):</span>
      <KeyValueList
        items={MORNING_SPLIT.map((s) => ({
          id: s.variant,
          label: `${s.qty} x ${VARIANTS[s.variant].name}`,
          value: <span className="tabular">{s.share === 0 ? 'gratis, 0,00 zł' : `${money(s.share, 'PLN')} udziału, stawka ${s.vat}%`}</span>,
        }))}
      />
    </div>
  );
}

/* ── Shared layout ────────────────────────────────────────────────── */

interface DetailProps {
  number: string;
  order: string;
  channel: string;
  kind?: ReactNode;
  status: ReactNode;
  alert?: ReactNode;
  lines: RetLine[];
  renderDetail?: (l: RetLine) => ReactNode;
  stock: ReactNode;
  money: ReactNode;
  extra?: ReactNode;
}

function ReturnDetail(p: DetailProps): ReactElement {
  const { go } = useProto();
  const items: KeyValueItem[] = [
    { id: 'order', label: 'Zamówienie', value: <a className="doc-ret-link mono-text" href="#order" onClick={(e) => { e.preventDefault(); go('order'); }}>{p.order}</a> },
    { id: 'channel', label: 'Kanał sprzedaży', value: p.channel },
    { id: 'opened', label: 'Zgłoszono', value: '3 listopada 2026, 14:12' },
    ...(p.kind ? [{ id: 'kind', label: 'Rodzaj', value: p.kind }] : []),
    { id: 'status', label: 'Stan', value: p.status },
  ];
  return (
    <PageLayout eyebrow="Zwroty" title={`Zwrot ${p.number}`} description="Co wróciło, co trafia na stan i ile oddajesz klientowi.">
      <div className="doc-ret">
        <DetailSection tone="hero" title="Zwrot">
          <KeyValueList items={items} />
        </DetailSection>
        {p.alert}
        <DetailSection title="Co wróciło">
          <ReturnLines lines={p.lines} renderDetail={p.renderDetail} />
        </DetailSection>
        <div className="doc-ret-grid">
          <DetailSection title="Stan magazynowy">{p.stock}</DetailSection>
          <DetailSection title="Zwrot pieniędzy">{p.money}</DetailSection>
        </div>
        {p.extra}
      </div>
    </PageLayout>
  );
}

/* ── Restock to components dialog ─────────────────────────────────── */

interface Comp {
  variant: string;
  qty: number;
  gift?: boolean;
}

function RestockComponentsDialog({ open, onOpenChange, components, onDone, pack }: { open: boolean; onOpenChange: (o: boolean) => void; components: Comp[]; onDone: (q: Record<string, number>) => void; pack?: boolean }): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(components.map((c) => [c.variant, c.qty])));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Przyjmij składniki na stan</DialogTitle>
        <DialogDescription>
          {pack
            ? 'PrestaShop liczy stan paku ze składników, więc przyjmij na stan składniki. To ręczna korekta stanu z powodem zwrot.'
            : 'Zwrot dotyczy pozycji zestawu. Wpisz, ile sztuk każdego składnika wróciło w dobrym stanie. Ilości podpowiadamy z zestawu zamrożonego przy sprzedaży.'}
        </DialogDescription>
        <div className="doc-ret-components">
          {components.map((c) => (
            <div key={c.variant} className="doc-ret-component">
              <span className="doc-ret-item">
                <span>{VARIANTS[c.variant].name}</span>
                <span className="doc-ret-item__marks">
                  <span className="mono-text text-muted">{VARIANTS[c.variant].sku}</span>
                  {c.gift ? <GiftMark compact /> : null}
                </span>
              </span>
              <Input
                className="doc-ret-qty tabular"
                type="number"
                min={0}
                max={c.qty}
                aria-label={`Ilość: ${VARIANTS[c.variant].name}`}
                value={qty[c.variant]}
                onChange={(e) => setQty((q) => ({ ...q, [c.variant]: Math.max(0, Math.min(c.qty, Number(e.target.value) || 0)) }))}
              />
            </div>
          ))}
        </div>
        <Note>Stan wraca do PrestaShop (kawowyswiat.pl), mastera tych składników. Kanały dostaną nowy stan przy najbliższej synchronizacji.</Note>
        <DialogFooter>
          <Button tone="ghost" onClick={() => onOpenChange(false)}>Anuluj</Button>
          <Button
            tone="primary"
            disabled={!canWrite}
            title={reason}
            onClick={() => {
              onDone(qty);
              onOpenChange(false);
            }}
          >
            Przyjmij składniki
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const restockedText = (q: Record<string, number>): string =>
  `Przyjęto na stan: ${Object.entries(q)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${VARIANTS[v].name.split(',')[0].split(' ').slice(0, 1).join(' ')} +${n}`)
    .join(', ')} w PrestaShop`;

/* ── Manual amount ────────────────────────────────────────────────── */

function AmountField({ label, value, onChange, description }: { label: string; value: string; onChange: (s: string) => void; description?: ReactNode }): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { unit } = useOrderMoney();
  return (
    <FormField label={`${label} (${unit})`} name="doc-ret-amount" description={description}>
      <Input className="doc-ret-amount tabular" inputMode="decimal" value={value} disabled={!canWrite} title={reason} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

function SaveRefund({ amount, disabled }: { amount: number | null; disabled?: boolean }): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const om = useOrderMoney();
  return (
    <div className="doc-ret-actions">
      <Button
        tone="primary"
        disabled={!canWrite || disabled || amount === null}
        title={reason ?? (amount === null ? 'Wpisz kwotę zwrotu.' : undefined)}
        onClick={() => showToast({ tone: 'success', title: 'Zapisano zwrot pieniędzy', description: `Kwota ${om.show(amount ?? 0)} czeka na wypłatę w kanale.` })}
      >
        Zapisz zwrot pieniędzy
      </Button>
    </div>
  );
}

/* ── Bundle returns ───────────────────────────────────────────────── */

const MORNING_COMPONENTS: Comp[] = [
  { variant: 'mug', qty: 1 },
  { variant: 'coffee', qty: 1 },
  { variant: 'spoon', qty: 1, gift: true },
];

function BundleWholeLine({ pack: packInitial = false }: { pack?: boolean }): ReactElement {
  const om = useOrderMoney();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pack, setPack] = useState(packInitial);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const [amount, setAmount] = useState(om.toInput(64_99));

  const line: RetLine = {
    id: 'r1', name: 'Zestaw poranny', sku: 'ZES-PORANNY', role: 'bundle', advised: 1, received: 1, restocked: done ? 1 : 0,
    reason: 'Odstąpienie od umowy', custody: done ? 'restocked' : 'blocked', money: 'pending', orderLine: BUNDLE_LINE_ID, orderLineNote: 'pozycja zestawu',
  };
  const steps: TrailStep[] = [
    { label: 'Paczka przyjęta w magazynie', state: 'done', detail: '3 listopada, Pakowacz: Ola' },
    {
      label: 'Automatyczne przyjęcie na stan',
      state: done ? 'skipped' : 'blocked',
      detail: pack ? 'Zestaw w PrestaShop to pak ze stanem ze składników. Zapis na pak PrestaShop zignoruje.' : 'Pozycja zestawu: wybierz składniki. OpenLinker nie przyjmuje zestawu w całości.',
    },
    { label: done ? restockedText(done) : 'Przyjęcie składników', state: done ? 'done' : 'active', detail: done ? 'Ręczna korekta stanu, powód: zwrot' : 'Podaj ilości z zestawu zamrożonego przy sprzedaży' },
    { label: 'Kanały dostaną nowy stan', state: done ? 'active' : 'todo' },
  ];

  return (
    <ReturnDetail
      number="ZW/2026/11/0087"
      order={ORDER_ALLEGRO}
      channel="Allegro"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone="review" withDot>Wymaga uwagi</StatusBadge>}
      alert={
        <Alert tone="warning" title="Zwrot zestawu idzie do ręcznej obsługi">
          Allegro zgłasza zwrot całej oferty zestawu (offerId i ilość). OpenLinker nie przyjmuje zestawu na stan i nie proponuje korekty sam, bo nie wie, które składniki wróciły w dobrym stanie.
        </Alert>
      }
      lines={[line]}
      renderDetail={() => <FrozenExpansion />}
      stock={
        <div className="doc-ret-stack">
          <StockPathTrail steps={steps} />
          <Switch checked={pack} onChange={setPack} label="Zestaw w PrestaShop jest pakiem (stan ze składników)" />
          {!done ? (
            <div className="doc-ret-actions">
              <Button tone="primary" onClick={() => setOpen(true)}>Przyjmij składniki na stan</Button>
            </div>
          ) : null}
          <RestockComponentsDialog
            open={open}
            onOpenChange={setOpen}
            components={MORNING_COMPONENTS}
            pack={pack}
            onDone={(q) => {
              setDone(q);
              showToast({ tone: 'success', title: 'Przyjęto składniki na stan', description: restockedText(q) });
            }}
          />
        </div>
      }
      money={
        <div className="doc-ret-money">
          <KeyValueList
            items={[
              { id: 'doc', label: 'Wartość na dokumencie', value: <span className="tabular">{om.show(64_99)} (jedna pozycja zestawu)</span> },
              { id: 'prop', label: 'Propozycja korekty', value: 'Brak: pozycja zestawu, kwotę ustalasz Ty' },
            ]}
          />
          <AmountField label="Kwota zwrotu" value={amount} onChange={setAmount} />
          <SaveRefund amount={om.fromInput(amount)} />
        </div>
      }
    />
  );
}

function BundleOneComponent(): ReactElement {
  const om = useOrderMoney();
  const { go } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const value = shareOf('coffee');
  const paidTotal = MORNING_SPLIT.reduce((sum, s) => sum + s.share, 0);
  // Allegro moderators' formula: what the buyer paid for the set minus the full price of what they keep, never below 0. The gift slot is left out (D6b).
  const suggested = Math.max(0, paidTotal - VARIANTS.mug.price);
  const [amount, setAmount] = useState(om.toInput(value));
  const [restocked, setRestocked] = useState(false);
  const parsed = om.fromInput(amount);
  const tooHigh = parsed !== null && parsed > value;
  const refund = parsed === null || tooHigh ? null : parsed;
  const usingSuggestion = parsed === suggested;

  return (
    <ReturnDetail
      number="ZW/2026/11/0091"
      order={ORDER_ALLEGRO}
      channel="Allegro"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone="info" withDot>Propozycja gotowa</StatusBadge>}
      lines={[
        {
          id: 'r1', name: VARIANTS.coffee.name, sku: VARIANTS.coffee.sku, role: 'component', partOf: 'Zestaw poranny', advised: 1, received: 1, restocked: restocked ? 1 : 0,
          reason: 'Odstąpienie od umowy', custody: restocked ? 'restocked' : 'received', money: 'proposed', orderLine: `${BUNDLE_LINE_ID}~c:coffee`, orderLineNote: 'składnik pozycji zestawu',
        },
      ]}
      stock={
        <div className="doc-ret-stack">
          <StockPathTrail
            steps={[
              { label: 'Paczka przyjęta w magazynie', state: 'done' },
              { label: restocked ? 'Przyjęto na stan: Kawa +1 w PrestaShop' : 'Przyjęcie na stan: Kawa +1', state: restocked ? 'done' : 'active', detail: 'Składnik, nie wariant zestawu. Kubek i łyżeczka zostają u klienta.' },
              { label: 'Kanały dostaną nowy stan', state: restocked ? 'active' : 'todo' },
            ]}
          />
          {!restocked ? (
            <div className="doc-ret-actions">
              <Button tone="primary" disabled={!canWrite} title={reason} onClick={() => { setRestocked(true); showToast({ tone: 'success', title: 'Przyjęto na stan', description: 'Kawa +1 w PrestaShop.' }); }}>
                Przyjmij na stan
              </Button>
            </div>
          ) : null}
        </div>
      }
      money={
        <div className="doc-ret-money">
          <KeyValueList
            items={[
              { id: 'doc', label: 'Wartość kawy na dokumencie', value: <span className="tabular">{om.show(value)}</span> },
              { id: 'src', label: 'Skąd ta kwota', value: 'Podział ceny zestawu zamrożony przy sprzedaży, nie dzisiejsze ceny' },
              { id: 'mug', label: 'Kubek zostaje u klienta', value: <span className="tabular">cena osobno {om.show(VARIANTS.mug.price)}, w zestawie {om.show(shareOf('mug'))}</span> },
            ]}
          />
          <AmountField
            label="Kwota zwrotu"
            value={amount}
            onChange={setAmount}
            description={tooHigh ? 'Kwota nie może przekroczyć wartości zwracanej kawy.' : 'Domyślnie pełna wartość kawy z dokumentu. OpenLinker nic nie potrąca sam.'}
          />
          <Alert
            tone="info"
            density="compact"
            title={`Podpowiedź: ${om.show(suggested)}`}
            action={
              usingSuggestion ? undefined : (
                <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => setAmount(om.toInput(suggested))}>
                  Użyj tej kwoty
                </Button>
              )
            }
          >
            Klient zatrzymuje kubek, który osobno kosztuje {om.show(VARIANTS.mug.price)}. Wzór: zapłacono za zestaw {om.show(paidTotal)} minus pełna cena zatrzymanych rzeczy, minimum 0. Tak liczą zwrot moderatorzy Allegro i aplikacja Swap dla Shopify. Użyj go tylko, gdy warunki oferty mówią, że rabat zestawu przepada.
          </Alert>
          <p className="doc-ret-total tabular">
            <span>Do zwrotu</span>
            <span>{refund === null ? '-' : om.show(refund)}</span>
          </p>
          <Note>Czy korygować też fakturę na kubek, gdy zwracasz mniej niż wartość kawy, rozstrzyga doradca. Korekta faktury obejmuje na razie tylko kawę.</Note>
          <div className="doc-ret-actions">
            <SaveRefund amount={refund} />
            <Button tone="secondary" onClick={() => go('returns', 'correction-invoice')}>Zobacz fakturę korygującą</Button>
          </div>
        </div>
      }
    />
  );
}

function BundleNoFrozenPrice(): ReactElement {
  const om = useOrderMoney();
  const { canWrite, reason } = useWriteGuard();
  const [amount, setAmount] = useState('');
  const hint = shareOf('coffee');
  return (
    <ReturnDetail
      number="ZW/2026/10/0412"
      order="Allegro 8810-0021-7745"
      channel="Allegro"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone="review" withDot>Wymaga uwagi</StatusBadge>}
      alert={
        <Alert tone="warning" title="Brak zamrożonej ceny składnika">
          To zamówienie jest z okresu pilotażu: dokument ma jedną pozycję zestawu, a podział ceny nie został zapisany. OpenLinker nie liczy go z dzisiejszych cen, bo kwota mogłaby różnić się od wartości na dokumencie. Kwotę ustalasz Ty.
        </Alert>
      }
      lines={[
        { id: 'r1', name: VARIANTS.coffee.name, sku: VARIANTS.coffee.sku, role: 'component', partOf: 'Zestaw poranny', advised: 1, received: 1, restocked: 1, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'pending', orderLine: 'li-5c20~c:coffee', orderLineNote: 'bez zamrożonego udziału' },
      ]}
      stock={<StockPathTrail steps={[{ label: 'Paczka przyjęta w magazynie', state: 'done' }, { label: 'Przyjęto na stan: Kawa +1 w PrestaShop', state: 'done' }, { label: 'Kanały dostały nowy stan', state: 'done' }]} />}
      money={
        <div className="doc-ret-money">
          <KeyValueList items={[{ id: 'doc', label: 'Na dokumencie', value: <span className="tabular">Zestaw poranny, {om.show(64_99)}, jedna pozycja</span> }]} />
          <AmountField label="Kwota zwrotu za kawę" value={amount} onChange={setAmount} description={`Podpowiedź z dzisiejszych cen: ${om.show(hint)}. To nie jest wartość z dokumentu.`} />
          <div className="doc-ret-actions">
            <Button tone="ghost" disabled={!canWrite} title={reason} onClick={() => setAmount(om.toInput(hint))}>Wpisz podpowiedź</Button>
          </div>
          <SaveRefund amount={amount ? om.fromInput(amount) : null} />
        </div>
      }
    />
  );
}

/* ── Gift returns (G-11) ──────────────────────────────────────────── */

type GiftMode = 'kept' | 'returned' | 'deducted';
type Decision = 'full' | 'deduct' | 'ask';

function GiftReturn({ mode }: { mode: GiftMode }): ReactElement {
  const om = useOrderMoney();
  const { role } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [kind, setKind] = useState<'withdrawal' | 'complaint'>('withdrawal');
  const [decision, setDecision] = useState<Decision>(mode === 'deducted' ? 'deduct' : 'full');
  const sample = GIFT_ORDER.sample;
  const giftValue = sample.price;

  const paidLines: RetLine[] =
    mode === 'deducted'
      ? [{ id: 'm', name: VARIANTS.mug.name, sku: VARIANTS.mug.sku, advised: 1, received: 1, restocked: 1, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'proposed', orderLine: 'li-3a10' }]
      : [
          { id: 'p', name: VARIANTS.press.name, sku: VARIANTS.press.sku, advised: 1, received: 1, restocked: 1, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'proposed', orderLine: 'li-3a01' },
          { id: 'm', name: VARIANTS.mug.name, sku: VARIANTS.mug.sku, advised: 2, received: 2, restocked: 2, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'proposed', orderLine: 'li-3a10' },
        ];
  const giftLine: RetLine = {
    id: 'g', name: sample.name, sku: sample.sku, role: 'gift', giftSource: 'ol-rule', advised: 0, received: mode === 'returned' ? 1 : 0, restocked: mode === 'returned' ? 1 : 0,
    reason: mode === 'returned' ? 'Wrócił z paczką' : 'Nie wrócił', custody: mode === 'returned' ? 'restocked' : 'kept', money: 'none', orderLine: 'ol-gift:promo-sample:li-3a01',
    orderLineNote: 'dodany w OpenLinkerze, Allegro go nie zna',
  };
  const paidBack = mode === 'deducted' ? VARIANTS.mug.price : GIFT_ORDER.press + GIFT_ORDER.mugs;
  const remaining = GIFT_ORDER.press + GIFT_ORDER.mugs - paidBack;
  const thresholdLost = remaining < GIFT_ORDER.threshold;
  const refund = mode === 'returned' || decision === 'full' ? paidBack : decision === 'deduct' ? paidBack - giftValue : paidBack;

  const restockedLabel =
    mode === 'deducted' ? 'Przyjęto na stan: Kubek +1 w PrestaShop' : mode === 'returned' ? 'Przyjęto na stan: Zaparzacz +1, Kubek +2, Próbka kawy +1 (gratis) w PrestaShop' : 'Przyjęto na stan: Zaparzacz +1, Kubek +2 w PrestaShop';

  return (
    <ReturnDetail
      number={mode === 'deducted' ? 'ZW/2026/11/0102' : mode === 'returned' ? 'ZW/2026/11/0099' : 'ZW/2026/11/0095'}
      order={GIFT_ORDER.number}
      channel="Allegro"
      kind={
        <SegmentedControl<'withdrawal' | 'complaint'>
          aria-label="Rodzaj zwrotu"
          value={kind}
          onChange={setKind}
          options={[{ value: 'withdrawal', label: 'Odstąpienie od umowy' }, { value: 'complaint', label: 'Reklamacja' }]}
        />
      }
      status={<StatusBadge tone={mode === 'returned' ? 'success' : 'review'} withDot>{mode === 'returned' ? 'Gotowy do zwrotu pieniędzy' : 'Wymaga decyzji'}</StatusBadge>}
      alert={
        <>
          {thresholdLost && mode !== 'returned' ? (
            <Alert tone="warning" title="Próg promocji utracony">
              Po zwrocie w zamówieniu zostaje {om.show(remaining)}, a próg promocji to {om.show(GIFT_ORDER.threshold)}. {mode === 'deducted' ? 'Klient zatrzymał próbkę kawy, która była gratisem za próg.' : 'Klient zwrócił płatne pozycje, a próbka kawy nie wróciła.'}
            </Alert>
          ) : null}
          {kind === 'complaint' ? (
            <Alert tone="info" title="Reklamacja to nie odstąpienie">
              Przy reklamacji (towar niezgodny z umową) klientowi może należeć się pełny zwrot niezależnie od gratisu. Sprawdź warunki oferty, zanim coś potrącisz.
            </Alert>
          ) : null}
        </>
      }
      lines={[...paidLines, giftLine]}
      stock={
        <div className="doc-ret-stack">
          <StockPathTrail
            steps={[
              { label: 'Paczka przyjęta w magazynie', state: 'done' },
              { label: restockedLabel, state: 'done', detail: mode === 'returned' ? 'Gratis wraca na stan jak każda pozycja' : 'Próbka kawy zostaje u klienta, jej stan się nie zmienia' },
              { label: 'Kanały dostały nowy stan', state: 'done' },
            ]}
          />
          <Note>Allegro zgłasza zwrot po ofercie i ilości. Gratis dodany w OpenLinkerze nie ma oferty, więc to, czy wrócił, zapisuje się tylko tutaj.</Note>
        </div>
      }
      money={
        <div className="doc-ret-money">
          <KeyValueList
            items={[
              { id: 'promo', label: 'Promocja', value: 'Próbka kawy przy zakupach od 150 zł' },
              { id: 'value', label: 'Deklarowana wartość gratisu', value: <span className="tabular">{om.show(giftValue)} (cena osobno)</span> },
              ...(role === 'packer' ? [] : [{ id: 'cost', label: 'Koszt gratisu', value: <span className="tabular">{om.show(sample.cost ?? 0)} netto</span> }]),
              { id: 'back', label: 'Czy gratis wrócił', value: mode === 'returned' ? 'Tak' : 'Nie' },
            ]}
          />
          {mode !== 'returned' ? (
            <div className="doc-lab-field">
              <span className="form-field__label" id="doc-ret-decision">Twoja decyzja</span>
              <SegmentedControl<Decision>
                aria-labelledby="doc-ret-decision"
                value={decision}
                onChange={setDecision}
                options={[
                  { value: 'full', label: 'Zwróć całość' },
                  { value: 'deduct', label: 'Potrąć wartość gratisu' },
                  { value: 'ask', label: 'Poproś o zwrot gratisu' },
                ]}
              />
              <p className="form-field__description">
                {decision === 'ask' ? 'Kwota czeka, aż gratis wróci.' : 'OpenLinker nie potrąca niczego sam. Decyzja zapisuje się przy zwrocie.'}
              </p>
            </div>
          ) : null}
          <p className="doc-ret-total tabular">
            <span>Do zwrotu</span>
            <span>{om.show(refund)}</span>
          </p>
          <div className="doc-ret-actions">
            <Button
              tone="primary"
              disabled={!canWrite}
              title={reason}
              onClick={() => showToast({ tone: 'success', title: 'Zapisano decyzję', description: `Do zwrotu ${om.show(refund)}.` })}
            >
              Zapisz decyzję
            </Button>
          </div>
        </div>
      }
    />
  );
}

/* ── Line matching (R-03, R-04) ───────────────────────────────────── */

function AllegroDuplicate(): ReactElement {
  const om = useOrderMoney();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [matched, setMatched] = useState('li-2');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ReturnDetail
      number="ZW/2026/11/0104"
      order="Allegro 8812-6610-0042"
      channel="Allegro"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone={confirmed ? 'success' : 'review'} withDot>{confirmed ? 'Dopasowanie potwierdzone' : 'Do potwierdzenia'}</StatusBadge>}
      alert={
        confirmed ? undefined : (
          <Alert tone="warning" title="Dwie identyczne pozycje w zamówieniu">
            Zamówienie ma tę samą ofertę kawy dwa razy, w tej samej cenie. Jedna jest w zestawie Allegro (BUNDLE), druga nie. Zwrot Allegro podaje tylko ofertę i ilość. OpenLinker podpowiada pozycję bez zestawu, ale nie przypisuje zwrotu sam: potwierdź albo wybierz drugą.
          </Alert>
        )
      }
      lines={[
        { id: 'r1', name: VARIANTS.coffee.name, sku: VARIANTS.coffee.sku, advised: 1, received: 1, restocked: 1, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'proposed', orderLine: matched, orderLineNote: confirmed ? (matched === 'li-2' ? 'potwierdzone przez operatora' : 'wybrane przez operatora') : 'podpowiedź: bez BUNDLE' },
      ]}
      stock={<StockPathTrail steps={[{ label: 'Paczka przyjęta w magazynie', state: 'done' }, { label: 'Przyjęto na stan: Kawa +1 w PrestaShop', state: 'done', detail: 'Ten sam produkt w obu pozycjach, więc wybór nie zmienia stanu' }]} />}
      money={
        <div className="doc-ret-money">
          <KeyValueList items={[{ id: 'p', label: 'Cena pozycji', value: <span className="tabular">{om.show(VARIANTS.coffee.price)}, taka sama w obu</span> }]} />
          <FormField label="Pozycja zamówienia" name="doc-ret-match" description="Podpowiedź: pozycja bez zestawu. Wybierz drugą, jeśli klient zwrócił kawę z zestawu.">
            <Select value={matched} disabled={!canWrite} title={reason} onChange={(e) => { setMatched(e.target.value); setConfirmed(false); }}>
              <option value="li-1">li-1, w zestawie Allegro (BUNDLE)</option>
              <option value="li-2">li-2, bez zestawu (podpowiedź)</option>
            </Select>
          </FormField>
          <div className="doc-ret-actions">
            <Button tone="primary" disabled={!canWrite || confirmed} title={reason} onClick={() => { setConfirmed(true); showToast({ tone: 'success', title: 'Potwierdzono dopasowanie', description: `Zwrot wskazuje pozycję ${matched}.` }); }}>
              Potwierdź dopasowanie
            </Button>
          </div>
        </div>
      }
      extra={
        <div className="doc-ret-grid">
          <ChannelPayload
            title="Allegro: pozycje zamówienia"
            lines={[
              { text: '{ "id": "li-1", "offer": { "id": "17142200311" }, "price": "34.99",', tone: 'muted' },
              { text: '  "discounts": [{ "type": "BUNDLE" }] },', tone: 'key' },
              { text: '{ "id": "li-2", "offer": { "id": "17142200311" }, "price": "34.99",', tone: 'muted' },
              { text: '  "discounts": null }', tone: 'key' },
            ]}
          />
          <ChannelPayload title="Allegro: zwrot" lines={[{ text: '{ "offerId": "17142200311", "quantity": 1, "price": "34.99" }', tone: 'warn' }]} />
        </div>
      }
    />
  );
}

function ErliIndexMismatch(): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ReturnDetail
      number="ZW/2026/11/0108"
      order="Erli 55087"
      channel="Erli"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone={confirmed ? 'success' : 'warning'} withDot>{confirmed ? 'Dopasowanie potwierdzone' : 'Do sprawdzenia'}</StatusBadge>}
      alert={
        confirmed ? undefined : (
          <Alert tone="warning" title="Indeks Erli nie zgadza się z obecnym zamówieniem">
            Erli wskazuje zwracaną pozycję numerem w tablicy pozycji. W zapisie z dnia zamówienia indeks 1 to kubek, ale zamówienie wczytane później ma kawę na tym miejscu. OpenLinker bierze zapis z dnia zamówienia i nie zgaduje dalej.
          </Alert>
        )
      }
      lines={[
        { id: 'r1', name: VARIANTS.mug.name, sku: VARIANTS.mug.sku, advised: 1, received: 1, restocked: confirmed ? 1 : 0, reason: 'Odstąpienie od umowy', custody: confirmed ? 'restocked' : 'review', money: confirmed ? 'proposed' : 'pending', orderLine: 'erli-55087#1', orderLineNote: 'z zapisu z dnia zamówienia' },
      ]}
      stock={
        <StockPathTrail
          steps={[
            { label: 'Paczka przyjęta w magazynie', state: 'done' },
            { label: confirmed ? 'Przyjęto na stan: Kubek +1 w PrestaShop' : 'Przyjęcie na stan czeka na potwierdzenie pozycji', state: confirmed ? 'done' : 'active' },
          ]}
        />
      }
      money={
        <div className="doc-ret-money">
          <KeyValueList
            items={[
              { id: 's', label: 'Zapis z dnia zamówienia', value: '0: Kawa, 1: Kubek' },
              { id: 'c', label: 'Obecne zamówienie', value: '0: Kubek, 1: Kawa' },
            ]}
          />
          {!confirmed ? (
            <div className="doc-ret-actions">
              <Button tone="primary" disabled={!canWrite} title={reason} onClick={() => { setConfirmed(true); showToast({ tone: 'success', title: 'Potwierdzono dopasowanie', description: 'Zwrot dotyczy kubka. Kubek wraca na stan.' }); }}>
                Potwierdź: kubek
              </Button>
            </div>
          ) : null}
        </div>
      }
      extra={<ChannelPayload title="Erli: zwrot" lines={[{ text: '{ "returns": [{ "items": [{ "index": 1, "quantity": 1 }] }] }', tone: 'warn' }]} />}
    />
  );
}

/* ── Correction invoice and PS pack ───────────────────────────────── */

function CorrectionInvoice(): ReactElement {
  const om = useOrderMoney();
  const original = originalInvoice();
  const corr = correctionInvoice();
  return (
    <ReturnDetail
      number="ZW/2026/11/0091"
      order={ORDER_ALLEGRO}
      channel="Allegro"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone="info" withDot>Faktura korygująca do wystawienia</StatusBadge>}
      lines={[
        { id: 'r1', name: VARIANTS.coffee.name, sku: VARIANTS.coffee.sku, role: 'component', partOf: 'Zestaw poranny', advised: 1, received: 1, restocked: 1, reason: 'Odstąpienie od umowy', custody: 'restocked', money: 'proposed', orderLine: `${BUNDLE_LINE_ID}~c:coffee` },
      ]}
      stock={<StockPathTrail steps={[{ label: 'Przyjęto na stan: Kawa +1 w PrestaShop', state: 'done' }]} />}
      money={
        <div className="doc-ret-money">
          <KeyValueList
            items={[
              { id: 'base', label: 'Korekta zmniejsza podstawę o', value: <span className="tabular">{om.show(shareOf('coffee'))}, wartość kawy z faktury</span> },
              { id: 'claw', label: 'Utracony rabat zestawu', value: <span className="tabular">{om.show(LOST_DISCOUNT)}, tylko gdy operator użył podpowiedzi; poza fakturą korygującą</span> },
            ]}
          />
          <Note>Faktura była wystawiona ze składnikami, więc kawa ma na niej własną wartość. Gdyby zestaw był jedną linią, korekta wymagałaby decyzji operatora.</Note>
        </div>
      }
      extra={
        <div className="doc-ret-grid">
          <DetailSection title="Faktura pierwotna">
            <InvoicePreview doc={original} />
          </DetailSection>
          <DetailSection title="Faktura korygująca">
            <InvoicePreview doc={corr} number="FK 2026/11/0019 do FV 2026/11/0412" />
          </DetailSection>
        </div>
      }
    />
  );
}

function PackRestockBlocked(): ReactElement {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  return (
    <ReturnDetail
      number="ZW/2026/11/0110"
      order="PrestaShop #20711"
      channel="PrestaShop"
      kind="Odstąpienie od umowy"
      status={<StatusBadge tone={done ? 'success' : 'warning'} withDot>{done ? 'Przyjęto na stan' : 'Przyjęcie wstrzymane'}</StatusBadge>}
      alert={
        done ? undefined : (
          <Alert tone="warning" title="Przyjęcie paku na stan zablokowane">
            Zestaw do parzenia to w PrestaShop pak ze stanem liczonym ze składników. Zapis stanu na pak PrestaShop przyjmuje, ale go ignoruje: składniki i liczba dostępnych paków się nie zmieniają. OpenLinker odmawia przed zapisem.
          </Alert>
        )
      }
      lines={[
        { id: 'r1', name: 'Zestaw do parzenia', sku: 'ZES-PARZENIE', role: 'bundle', advised: 1, received: 1, restocked: done ? 1 : 0, reason: 'Odstąpienie od umowy', custody: done ? 'restocked' : 'blocked', money: 'proposed', orderLine: 'ps-20711-1', orderLineNote: 'pak PrestaShop' },
      ]}
      stock={
        <div className="doc-ret-stack">
          <StockPathTrail
            steps={[
              { label: 'Paczka przyjęta w magazynie', state: 'done' },
              { label: 'Przyjęcie na stan paku', state: done ? 'skipped' : 'blocked', detail: 'Stan paku wynika ze składników: przyjmij składniki' },
              { label: done ? restockedText(done) : 'Przyjęcie składników', state: done ? 'done' : 'active', detail: 'Ręczna korekta stanu, powód: zwrot' },
            ]}
          />
          <KeyValueList items={[{ id: 'pst', label: 'Typ stanu paku w PrestaShop', value: 'Zmniejszaj tylko produkty z paku' }]} />
          {!done ? (
            <div className="doc-ret-actions">
              <Button tone="primary" onClick={() => setOpen(true)}>Przyjmij składniki na stan</Button>
            </div>
          ) : null}
          <RestockComponentsDialog
            open={open}
            onOpenChange={setOpen}
            pack
            components={[{ variant: 'press', qty: 1 }, { variant: 'coffee', qty: 2 }]}
            onDone={(q) => {
              setDone(q);
              showToast({ tone: 'success', title: 'Przyjęto składniki na stan', description: restockedText(q) });
            }}
          />
        </div>
      }
      money={<KeyValueList items={[{ id: 'm', label: 'Zwrot pieniędzy', value: 'Bez zmian: pak był jedną pozycją, kwota z dokumentu 139,00 zł' }]} />}
    />
  );
}

/* ── States ───────────────────────────────────────────────────────── */

const STATES: StateDef[] = [
  { id: 'bundle-whole-line', label: 'Zwrot całego zestawu', note: 'Allegro zgłasza zwrot oferty zestawu. OpenLinker nie przyjmuje zestawu na stan i nie proponuje korekty sam. Operator wybiera składniki w oknie, a stan wraca na składniki w PrestaShop.', useCases: ['R-01', 'B-15'], priority: 'pilot', channels: ['allegro'] },
  { id: 'bundle-one-component', label: 'Zwrot jednego składnika', note: 'Klient oddaje samą kawę z zestawu. Kwota zwrotu to domyślnie wartość kawy z podziału zamrożonego przy sprzedaży. Obok jest podpowiedź liczona wzorem Allegro (zapłacono minus pełna cena zatrzymanych rzeczy, minimum 0), którą operator może użyć jednym kliknięciem. Na stan wraca kawa, nie wariant zestawu. Decyzja: nikt na rynku nie potrąca rabatu zestawu automatycznie; moderatorzy Allegro (2026) i Swap dla Shopify liczą tym wzorem, a sprzedawca edytuje kwotę, więc OL tylko podpowiada.', useCases: ['B-15', 'R-02', 'R-05'], priority: 'later', channels: ['allegro'] },
  { id: 'bundle-no-frozen-price', label: 'Brak zamrożonej ceny', note: 'Zamówienie z okresu pilotażu ma na dokumencie jedną pozycję zestawu i nie ma zapisanego podziału. OpenLinker podaje podpowiedź z dzisiejszych cen, ale kwotę wpisuje operator.', useCases: ['R-05', 'B-15'], priority: 'pilot' },
  { id: 'gift-kept', label: 'Gratis zostaje u klienta', note: 'Klient zwraca płatne pozycje i zatrzymuje próbkę kawy. OpenLinker pokazuje wartość gratisu i warunki promocji, a operator decyduje: zwrot całości, potrącenie albo prośba o zwrot gratisu. Decyzja: zatrzymany gratis nigdy nie jest potrącany automatycznie; tak robią wszystkie sprawdzone narzędzia (BaseLinker, Apilo, Sellasist, Linnworks, Brightpearl), a spory na forum Allegro pokazują, że zależy to od warunków oferty.', useCases: ['G-11'], priority: 'later', channels: ['allegro'] },
  { id: 'gift-returned', label: 'Gratis wrócił', note: 'Próbka kawy wróciła z paczką. Wraca na stan jak każda pozycja, z powodem zwrot. Allegro jej nie zna, więc jej zwrot zapisuje się tylko w OpenLinkerze.', useCases: ['G-11'], priority: 'later', channels: ['allegro'] },
  { id: 'gift-deducted', label: 'Próg utracony, potrącenie', note: 'Zwrot jednego kubka zbija zamówienie poniżej progu 150 zł, a klient zatrzymuje gratis. Operator wybrał potrącenie wartości gratisu. Przy reklamacji pokazujemy, że pełny zwrot może się należeć.', useCases: ['G-11'], priority: 'later', channels: ['allegro'] },
  { id: 'allegro-duplicate-lines', label: 'Duplikat pozycji Allegro', note: 'Ta sama oferta kawy jest w zamówieniu dwa razy w tej samej cenie, raz w zestawie Allegro. Zwrot podaje tylko ofertę, więc OpenLinker podpowiada pozycję bez BUNDLE, a operator potwierdza albo wybiera drugą. Decyzja: Linnworks, Brightpearl, Apilo i Sellasist dają wybór pozycji operatorowi, więc OL nie przypisuje zwrotu po cichu.', useCases: ['R-03'], priority: 'pilot', channels: ['allegro'] },
  { id: 'erli-index-mismatch', label: 'Indeks Erli niezgodny', note: 'Erli wskazuje pozycję zwrotu numerem w tablicy. Gdy kolejność pozycji zmieniła się po ponownym wczytaniu, OpenLinker bierze zapis z dnia zamówienia i oznacza zwrot do sprawdzenia.', useCases: ['R-04'], priority: 'later', channels: ['erli'] },
  { id: 'correction-invoice', label: 'Faktura korygująca', note: 'Korekta faktury za zwróconą kawę ze składnikami zestawu. Wartość pochodzi z faktury pierwotnej. Utracony rabat zestawu (jeśli operator użył podpowiedzi przy zwrocie) jest poza korektą, dopóki doradca nie zdecyduje inaczej.', useCases: ['B-15', 'R-05'], priority: 'later' },
  { id: 'pack-restock-blocked', label: 'Pak PrestaShop zablokowany', note: 'Pak PrestaShop ze stanem ze składników ignoruje zapis stanu na pak. OpenLinker odmawia przed zapisem, a operator przyjmuje składniki ręczną korektą.', useCases: ['R-06'], priority: 'pilot', channels: ['prestashop'] },
  ...commonStates('zwrotów', 'zapisz zwrot ręcznie albo poczekaj na pierwszy zwrot z kanału'),
];

function render(state: string): ReactElement {
  switch (state) {
    case 'bundle-one-component':
      return <BundleOneComponent />;
    case 'bundle-no-frozen-price':
      return <BundleNoFrozenPrice />;
    case 'gift-kept':
      return <GiftReturn key="kept" mode="kept" />;
    case 'gift-returned':
      return <GiftReturn key="returned" mode="returned" />;
    case 'gift-deducted':
      return <GiftReturn key="deducted" mode="deducted" />;
    case 'allegro-duplicate-lines':
      return <AllegroDuplicate />;
    case 'erli-index-mismatch':
      return <ErliIndexMismatch />;
    case 'correction-invoice':
      return <CorrectionInvoice />;
    case 'pack-restock-blocked':
      return <PackRestockBlocked />;
    default:
      return <BundleWholeLine />;
  }
}

export const screen: ScreenDef = {
  id: 'returns',
  group: 'Sprzedaż',
  label: 'Zwroty',
  states: STATES,
  render,
};
