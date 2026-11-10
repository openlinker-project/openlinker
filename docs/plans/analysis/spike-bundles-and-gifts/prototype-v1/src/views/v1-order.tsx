/**
 * v1 order detail, simple version. A gift shows once, in its line, with the
 * cost under it; a bundle is a header line with indented components. Stock
 * paths, versions and channel payloads appear only when something is off.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { Popover, PopoverContent, PopoverTrigger } from '@web/shared/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web/shared/ui/dialog';
import { Combobox, type ComboboxOption, type ComboboxValue } from '@web/shared/ui/combobox';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { useToast } from '@web/shared/ui/toast-provider';
import { ActivityTimelineList } from '@web/features/orders/components/activity-timeline-list';
import type { TimelineEvent } from '@web/features/orders/components/order-activity-timeline';
import { BUNDLES, CHANNELS, VARIANTS, type GiftSource } from '../model/catalog';
import { commonStates, useMoney, useProto, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, ChannelPayload, GiftMark, StockPathTrail, WhoPaysStrip, type TrailStep } from '../ui/marks';
import { ORDER_SCENARIOS, gift, lineImage, lineName, lineSku, v, type OrdEvent, type OrdLine, type OrdScenario } from './ord-data';
import { masterShort, useEffectiveOms, useOrderMoney } from './ord-ui';
import './v1-ops.css';

/* ── Small shared pieces (also used by v1-orders and v1-returns) ───── */

/** Prototype-only variant picker: one state, several situations. Not product UI. */
export function VariantPicker<T extends string>({ value, onChange, options, label = 'Wariant tego stanu' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }): ReactElement {
  return (
    <div className="v1o-variant" role="group" aria-label={label}>
      <span className="v1o-variant__label">{label} (tylko w prototypie)</span>
      <SegmentedControl aria-label={label} value={value} onChange={onChange} options={options} />
    </div>
  );
}

const SOURCE_TEXT: Record<GiftSource, string> = {
  'ol-rule': 'Dodała go promocja w OpenLinkerze.',
  'cart-rule': 'Przyszedł z reguły koszyka w PrestaShop.',
  'channel-flag': 'Kanał sprzedaży oznaczył go jako gratis.',
  inferred: 'Rozpoznany po cenie 0,01 zł (reguła połączenia).',
  operator: 'Dodany ręcznie przez operatora.',
};

/** The gift tag. Click shows where the gift came from and who funds it. */
export function GiftTag({ line, channel }: { line: OrdLine; channel?: string }): ReactElement {
  const src = line.partOf ? `Jest w składzie zestawu "${line.partOf}".` : line.giftSource ? SOURCE_TEXT[line.giftSource] : 'Gratis.';
  const fund = line.funder === 'unknown' ? 'Kanał nie podał, kto finansuje.' : line.funder === 'channel' ? 'Finansuje kanał.' : 'Finansujesz Ty.';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="v1o-gift-btn" aria-label="Gratis: skąd i kto płaci">
          <GiftMark compact />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} aria-label="Skąd jest gratis">
        <div className="v1o-pop">
          <p className="v1o-pop__title">Gratis</p>
          <p>{src} {fund}</p>
          {line.olOnly && channel ? <p>{channel} nie widzi tej pozycji. Jest tylko w OpenLinkerze i trafi do paczki.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Drop technical keys and composition versions from history text. */
function clean(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(/\s*\(wersja \d+\)/g, '')
    .replace(/\s*Pozycja [^\s]+~[^\s]+\./g, '')
    .replace(/\s*Pozycja ol-gift:[^\s]+\./g, '')
    .replace(/Wersja 2 ma w składzie łyżeczkę jako gratis\./, 'Zestaw ma w składzie łyżeczkę jako gratis.')
    .replace(/\(wersja 2\)/g, '')
    .replace(/Routing odmówił/g, 'Nie przydzielono do pakowania')
    .trim();
}

function Timeline({ events }: { events: OrdEvent[] }): ReactElement {
  const items: TimelineEvent[] = events.map((e, i) => ({ id: `ev-${String(i)}`, timestamp: e.at, title: clean(e.title) ?? '', by: e.by, description: clean(e.desc), tone: e.tone ?? 'default' }));
  return (
    <DetailSection title="Historia">
      <ActivityTimelineList events={items} ariaLabel="Historia zamówienia" />
    </DetailSection>
  );
}

/* ── Lines ─────────────────────────────────────────────────────────── */

const bundleKeyBySku = (sku?: string): string | undefined => Object.keys(BUNDLES).find((k) => BUNDLES[k].sku === sku);

function oldComposition(l: OrdLine): string | null {
  if (l.kind !== 'bundle' || !l.version) return null;
  const key = bundleKeyBySku(l.sku);
  if (!key) return null;
  const latest = Math.max(...BUNDLES[key].versions.map((x) => x.version));
  if (l.version >= latest) return null;
  return 'Zamówienie ma skład sprzed zmiany zestawu. Pakowacz dostanie skład z dnia zamówienia.';
}

interface LinesProps {
  s: OrdScenario;
  oms: boolean;
  showIgnored?: boolean;
}

function Lines({ s, oms, showIgnored }: LinesProps): ReactElement {
  const { fmt } = useOrderMoney(s);
  const { state: protoState } = useProto();
  const channel = CHANNELS[s.channel].name;
  const rows = s.lines.filter((l) => l.kind !== 'ignored' || showIgnored);

  const trailOf = (l: OrdLine): TrailStep[] | null => {
    if (l.trail && l.trail.some((t) => t.state === 'blocked')) return l.trail;
    if (l.kind === 'gift' && l.olOnly && !oms && !l.removed && s.stage !== 'cancelled') {
      return [
        { label: `Wysłano do ${masterShort(l.variant)} jako pozycja 0,00 zł`, state: 'done' },
        { label: 'Sklep zdejmie stan sam', state: 'todo' },
      ];
    }
    return null;
  };

  const columns: DataTableColumn<OrdLine>[] = [
    {
      id: 'item',
      header: 'Pozycja',
      lines: 3,
      cell: (l) => {
        const child = Boolean(l.partOf) || l.kind === 'component';
        const trail = trailOf(l);
        const old = protoState === 'bundle' ? oldComposition(l) : null;
        const isGift = l.kind === 'gift';
        const unitCost = l.variant ? v(l.variant).cost : null;
        return (
          <div className={['v1o-item', child ? 'v1o-item--child' : '', l.removed ? 'v1o-item--removed' : '', l.kind === 'ignored' ? 'v1o-item--ignored' : ''].filter(Boolean).join(' ')}>
            <ProductThumbnail name={lineName(l)} src={lineImage(l)} size="sm" />
            <div className="v1o-item__body">
              <span className={`v1o-item__name${l.kind === 'bundle' ? ' v1o-item__name--bundle' : ''}`}>
                {l.kind === 'bundle' ? <BundleMark compact /> : null}
                {isGift ? <GiftTag line={l} channel={channel} /> : null}
                <span>{lineName(l)}</span>
              </span>
              <span className="v1o-item__sku">{lineSku(l)}</span>
              {isGift && !l.removed ? <WhoPaysStrip qty={l.qty} unitCost={unitCost} funder={l.funder ?? 'seller'} buyerPays={l.giftSource === 'inferred' ? l.unitPrice * l.qty : 0} compact /> : null}
              {old ? <span className="v1o-item__note">{old}</span> : null}
              {l.removed || l.kind === 'ignored' || l.kind === 'service' ? <span className="v1o-item__note">{l.kind === 'ignored' ? 'Pominięta: składnik zestawu przysłany osobno.' : l.note}</span> : null}
              {trail ? <StockPathTrail steps={trail} label="Co się stało ze stanem" /> : null}
            </div>
          </div>
        );
      },
    },
    { id: 'qty', header: 'Ilość', align: 'right', cell: (l) => <span className="tabular">{l.qty}</span> },
    {
      id: 'price',
      header: 'Cena',
      align: 'right',
      cell: (l) => {
        if (l.kind === 'component' || l.kind === 'ignored') return <span className="v1o-muted">w cenie zestawu</span>;
        if (l.kind === 'gift') {
          const pays = l.giftSource === 'inferred' ? l.unitPrice * l.qty : 0;
          return (
            <span className="v1o-price">
              <span className="tabular">{fmt(pays)}</span>
              {!l.partOf ? <span className="v1o-price__list tabular">{fmt((l.listPrice ?? 0) * l.qty)}</span> : null}
            </span>
          );
        }
        return <span className="tabular">{fmt(l.unitPrice * l.qty)}</span>;
      },
    },
    {
      id: 'status',
      header: 'Stan',
      hideBelow: 768,
      cell: (l) =>
        l.status && !l.removed && l.kind !== 'ignored' ? (
          <StatusBadge tone={l.status.tone} compact withDot>
            {l.status.label}
          </StatusBadge>
        ) : null,
    },
  ];

  return (
    <DataTable
      caption="Pozycje zamówienia"
      columns={columns}
      rows={rows}
      rowKey={(l) => l.id}
      rowClassName={(l) => (l.kind === 'ignored' ? 'v1o-row--ignored' : undefined)}
    />
  );
}

/* ── Price panel ───────────────────────────────────────────────────── */

function Totals({ s }: { s: OrdScenario }): ReactElement {
  const { fmt } = useOrderMoney(s);
  const [open, setOpen] = useState(false);
  const live = s.lines.filter((l) => !l.removed);
  const paidLines = live.filter((l) => l.kind === 'goods' || l.kind === 'bundle' || l.kind === 'service');
  const list = paidLines.reduce((a, l) => a + (l.listPrice ?? l.unitPrice) * l.qty, 0);
  const paid = paidLines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const giftCharge = live.filter((l) => l.kind === 'gift' && l.giftSource === 'inferred').reduce((a, l) => a + l.unitPrice * l.qty, 0);
  const rebates = paid - list;
  const total = paid + giftCharge + s.shipping;
  const details = s.adjustments.filter((a) => !a.label.startsWith('Gratis'));
  return (
    <DetailSection title="Płatność" titleAside={<span className="v1o-muted">{s.payment}</span>}>
      <div className="v1o-totals">
        <div className="v1o-totals__row"><span>Produkty</span><span className="tabular">{fmt(list)}</span></div>
        {rebates < 0 ? (
          <div className="v1o-totals__row"><span>Rabaty</span><span className="tabular">{fmt(rebates)}</span></div>
        ) : null}
        {open && details.length ? (
          <div className="v1o-totals__detail">
            {details.map((d) => (
              <div key={d.label} className="v1o-totals__row"><span>{d.label}</span><span className="tabular">{fmt(d.amount)}</span></div>
            ))}
          </div>
        ) : null}
        {giftCharge > 0 ? <div className="v1o-totals__row"><span>Gratisy</span><span className="tabular">{fmt(giftCharge)}</span></div> : null}
        <div className="v1o-totals__row"><span>Dostawa</span><span className="tabular">{fmt(s.shipping)}</span></div>
        <div className="v1o-totals__row v1o-totals__row--strong"><span>Zapłacono</span><span className="tabular">{fmt(total)}</span></div>
        {details.length ? (
          <button type="button" className="v1o-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}
          </button>
        ) : null}
      </div>
    </DetailSection>
  );
}

/* ── Add gift dialog ───────────────────────────────────────────────── */

export type AddGiftStage = 'open' | 'document' | 'packed';
const REASONS = ['Bez powodu', 'Przeprosiny za problem z zamówieniem', 'Obietnica z opisu oferty', 'Prezent dla stałego klienta'];

function AddGiftDialog({ open, onOpenChange, stage, s, canWrite, reason, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; stage: AddGiftStage; s: OrdScenario; canWrite: boolean; reason?: string; onAdded: (l: OrdLine) => void }): ReactElement {
  const money = useMoney();
  const { showToast } = useToast();
  const [value, setValue] = useState<ComboboxValue | null>({ kind: 'dictionary', ids: ['spoon'] });
  const [qty, setQty] = useState('1');
  const [why, setWhy] = useState(REASONS[0]);
  const options: ComboboxOption[] = useMemo(
    () =>
      Object.entries(VARIANTS).map(([key, x]) => {
        const free = Math.max(0, x.stock - x.held);
        return { id: key, label: x.name, hint: `wolne ${String(free)} szt.`, disabled: free === 0, disabledReason: free === 0 ? 'Brak na stanie' : undefined };
      }),
    [],
  );
  const picked = value?.kind === 'dictionary' ? value.ids[0] : undefined;
  const n = Math.max(1, Number.parseInt(qty, 10) || 1);
  const refused = stage === 'packed';
  const blocked = !canWrite || refused || !picked;
  const title = !canWrite ? reason : refused ? 'Paczka jest już zamknięta.' : !picked ? 'Wybierz produkt' : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="v1o-dialog" aria-describedby="v1o-add-gift-desc">
        <DialogTitle>Dodaj gratis</DialogTitle>
        <DialogDescription id="v1o-add-gift-desc">Kupujący nic za niego nie płaci. Pakowacz zobaczy go w paczce.</DialogDescription>
        {refused ? (
          <Alert tone="error" density="compact" title="Paczka jest już zamknięta">
            Gratis nie trafi do tej paczki. Wyślij go osobno albo dołóż do następnego zamówienia klienta.
          </Alert>
        ) : null}
        {stage === 'document' ? (
          <Alert tone="warning" density="compact" title="Paragon jest już wystawiony">
            Na wystawionym paragonie gratisu nie będzie. Kwota się nie zmienia, więc korekta nie jest potrzebna.
          </Alert>
        ) : null}
        <div className="v1o-form">
          <FormField label="Produkt" name="v1-gift-product">
            <Combobox options={options} value={value} onChange={setValue} placeholder="Szukaj produktu" disabled={refused} />
          </FormField>
          <div className="v1o-form__row">
            <FormField label="Ilość" name="v1-gift-qty">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} disabled={refused} />
            </FormField>
            <FormField label="Powód (opcjonalnie)" name="v1-gift-reason">
              <Select value={why} onChange={(e) => setWhy(e.target.value)} disabled={refused}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </FormField>
          </div>
          {picked && !refused ? <WhoPaysStrip qty={n} unitCost={v(picked).cost} compact /> : null}
        </div>
        <DialogFooter>
          <Button tone="ghost" onClick={() => onOpenChange(false)}>Anuluj</Button>
          <Button
            tone="primary"
            disabled={blocked}
            title={title}
            onClick={() => {
              if (!picked) return;
              onAdded(gift(`manual-${picked}`, picked, n, 'operator', { olOnly: true, status: { label: 'Zarezerwowano', tone: 'success' } }));
              onOpenChange(false);
              showToast({ tone: 'success', title: 'Dodano gratis', description: `${lineName({ id: '', kind: 'gift', variant: picked, qty: n, unitPrice: 0 })}, ${String(n)} szt. Koszt ${money((v(picked).cost ?? 0) * n, 'PLN')}.` });
            }}
          >
            Dodaj gratis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Page ──────────────────────────────────────────────────────────── */

interface PageProps {
  s: OrdScenario;
  banner?: ReactNode;
  readOnly?: boolean;
  giftStage?: AddGiftStage;
  giftOpen?: boolean;
  showIgnored?: boolean;
  below?: ReactNode;
  linesAction?: ReactNode;
}

export function OrderPage({ s: initial, banner, readOnly, giftStage = 'open', giftOpen = false, showIgnored, below, linesAction }: PageProps): ReactElement {
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !readOnly;
  const reason = readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;
  const oms = useEffectiveOms(initial);
  const [added, setAdded] = useState<OrdLine[]>([]);
  const [open, setOpen] = useState(giftOpen);
  const s: OrdScenario = { ...initial, lines: [...initial.lines, ...added] };
  const ch = CHANNELS[s.channel];
  const cancelled = s.stage === 'cancelled';
  return (
    <PageLayout
      eyebrow="Zamówienie"
      title={`Zamówienie ${s.number}`}
      description={`${ch.name} · ${s.buyer}, ${s.city} · ${s.delivery}`}
      actions={
        <Button tone="secondary" disabled={!canWrite || cancelled} title={!canWrite ? reason : cancelled ? 'Zamówienie jest anulowane.' : undefined} onClick={() => setOpen(true)}>
          Dodaj gratis
        </Button>
      }
    >
      <div className="v1o-stack">
        <div className="v1o-badges">
          {s.health.tone !== 'success' ? <StatusBadge tone={s.health.tone} withDot>{s.health.label}</StatusBadge> : null}
          <StatusBadge tone={s.phase.tone} withDot>{s.phase.label}</StatusBadge>
        </div>
        {banner}
        <div className="v1o-grid">
          <div className="v1o-stack">
            <DetailSection title="Pozycje" titleAside={linesAction}>
              <Lines s={s} oms={oms} showIgnored={showIgnored} />
            </DetailSection>
            {below}
            <Timeline events={s.timeline} />
          </div>
          <div className="v1o-stack">
            <Totals s={s} />
            {s.payload ? (
              <DetailSection>
                <details className="v1o-details">
                  <summary>Pokaż, co przysłał {ch.name}</summary>
                  <ChannelPayload title={s.payload.title} lines={s.payload.lines} />
                </details>
              </DetailSection>
            ) : null}
          </div>
        </div>
      </div>
      <AddGiftDialog open={open} onOpenChange={setOpen} stage={giftStage} s={s} canWrite={canWrite} reason={reason} onAdded={(l) => setAdded((a) => [...a, l])} />
    </PageLayout>
  );
}

/* ── States with their own small UI ────────────────────────────────── */

const S = ORDER_SCENARIOS;

function BundleState({ initial = 'erli', readOnly }: { initial?: 'erli' | 'allegro'; readOnly?: boolean }): ReactElement {
  const [variant, setVariant] = useState<'erli' | 'allegro'>(initial);
  const [editTried, setEditTried] = useState(false);
  const s = variant === 'erli' ? S['bundle-plus-gift'] : S['bundle-allegro'];
  return (
    <div className="v1o-stack">
      {!readOnly ? (
        <VariantPicker value={variant} onChange={setVariant} options={[{ value: 'erli', label: 'Zestaw z gratisem w składzie (Erli)' }, { value: 'allegro', label: 'Skład sprzed zmiany (Allegro)' }]} />
      ) : null}
      <OrderPage
        s={s}
        readOnly={readOnly}
        linesAction={
          <button type="button" className="v1o-link" onClick={() => setEditTried(true)}>Zmień pozycje</button>
        }
        banner={
          editTried ? (
            <Alert tone="info" title="Zestawu nie zmienisz częściowo" action={<Button tone="ghost" className="button--sm" onClick={() => setEditTried(false)}>Rozumiem</Button>}>
              Składnik zestawu nie ma własnej ceny w zamówieniu. Usuń cały zestaw albo dodaj produkt osobno.
            </Alert>
          ) : null
        }
      />
    </div>
  );
}

function GiftOlOnlyState(): ReactElement {
  const [mode, setMode] = useState<'line' | 'pilot'>('line');
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  return (
    <div className="v1o-stack">
      <VariantPicker value={mode} onChange={setMode} options={[{ value: 'line', label: 'Gratis jako pozycja (docelowo)' }, { value: 'pilot', label: 'Notatka dla pakowacza (pilot)' }]} />
      {mode === 'line' ? (
        <OrderPage s={S['gift-ol-only']} />
      ) : (
        <OrderPage
          s={S['pilot-mode']}
          banner={
            done ? (
              <Alert tone="success" title="Zdjęto stan ręcznie">Łyżeczka do kawy: -1 w PrestaShop, powód: gratis.</Alert>
            ) : (
              <Alert
                tone="info"
                title="Gratis jest w notatce dla pakowacza"
                action={
                  <Button tone="secondary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => { setDone(true); showToast({ tone: 'success', title: 'Zdjęto stan ręcznie', description: 'Łyżeczka do kawy: -1 w PrestaShop, powód: gratis.' }); }}>
                    Zdejmij stan ręcznie
                  </Button>
                }
              >
                W pilocie łyżeczki nie ma wśród pozycji. Pakowacz dołoży ją według notatki, a stan zdejmujesz jednym kliknięciem.
              </Alert>
            )
          }
        />
      )}
    </div>
  );
}

type ChannelGift = 'prestashop' | 'idosell' | 'empik' | 'shoper';
const CHANNEL_GIFT_SCENARIO: Record<ChannelGift, string> = { prestashop: 'gift-cart-rule', idosell: 'gift-channel-flag', empik: 'gift-channel-flag-empik', shoper: 'gift-inferred' };

function GiftFromChannelState({ initial = 'prestashop' }: { initial?: ChannelGift }): ReactElement {
  const [ch, setCh] = useState<ChannelGift>(initial);
  return (
    <div className="v1o-stack">
      <VariantPicker
        value={ch}
        onChange={setCh}
        options={[
          { value: 'prestashop', label: 'PrestaShop, reguła koszyka' },
          { value: 'idosell', label: 'IdoSell, flaga' },
          { value: 'empik', label: 'Empik, flaga' },
          { value: 'shoper', label: 'Shoper, cena 0,01 zł' },
        ]}
      />
      <OrderPage s={S[CHANNEL_GIFT_SCENARIO[ch]]} />
    </div>
  );
}

function GiftOutOfStockState(): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const { go } = useProto();
  const [choice, setChoice] = useState<string | null>(null);
  const decide = (c: string, msg: string): void => {
    setChoice(c);
    showToast({ tone: 'success', title: msg, description: 'Decyzja zapisana w historii zamówienia.' });
  };
  return (
    <OrderPage
      s={S['gift-out-of-stock']}
      banner={
        choice ? (
          <Alert tone="success" title={choice}>Zamówienie poszło dalej. Promocja wstrzymała się sama, bo łyżeczki się skończyły.</Alert>
        ) : (
          <Alert
            tone="error"
            title="Gratisu brakuje na stanie"
            action={
              <div className="button-group">
                <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => decide('Wysłano bez gratisu', 'Wysłano bez gratisu')}>Wyślij bez gratisu</Button>
                <Button tone="secondary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => decide('Gratis zamieniony na torbę prezentową', 'Zamieniono gratis')}>Daj torbę zamiast</Button>
                <Button tone="ghost" className="button--sm" onClick={() => go('promotions', 'list')}>Zobacz promocję</Button>
              </div>
            }
          >
            Promocja dodała łyżeczkę do kawy, ale wolnej sztuki nie ma. Zamówienie czeka na Twoją decyzję.
          </Alert>
        )
      }
    />
  );
}

type NotAdded = 'two' | 'limit' | 'customer' | 'threshold';
function GiftNotAddedState({ initial = 'two' }: { initial?: NotAdded }): ReactElement {
  const [w, setW] = useState<NotAdded>(initial);
  const { go } = useProto();
  const map: Record<NotAdded, { s: string; title: string; body: string }> = {
    two: { s: 'two-rules-matched', title: 'Pasowały 2 promocje, dodano 1', body: 'Łyżeczka jest wyżej na liście promocji. "Próbka kawy przy zakupach od 150 zł" nie łączy się z innymi, więc jej nie dodano.' },
    limit: { s: 'limit-reached', title: 'Gratisu nie dodano: limit promocji wyczerpany', body: 'Promocja "Torba prezentowa przy 2 kubkach" wydała wszystkie 50 toreb i wstrzymała się sama.' },
    customer: { s: 'customer-limit-reached', title: 'Gratisu nie dodano: klient już go dostał', body: 'Limit to 1 próbka na klienta. Ten klient dostał ją 12 października w zamówieniu 7d21f0aa.' },
    threshold: { s: 'gift-removed-below-threshold', title: 'Gratis usunięty po zmianie zamówienia', body: 'Po zmianie ilości koszyk spadł do 123,99 zł, poniżej progu 150 zł. Rezerwacja próbki wróciła do puli.' },
  };
  const x = map[w];
  return (
    <div className="v1o-stack">
      <VariantPicker
        value={w}
        onChange={setW}
        options={[
          { value: 'two', label: 'Dwie promocje' },
          { value: 'limit', label: 'Limit sztuk' },
          { value: 'customer', label: 'Limit na klienta' },
          { value: 'threshold', label: 'Poniżej progu' },
        ]}
      />
      <OrderPage
        s={S[x.s]}
        banner={
          <Alert tone="info" title={x.title} action={<Button tone="ghost" className="button--sm" onClick={() => go('promotions', 'list')}>Otwórz promocje</Button>}>
            {x.body}
          </Alert>
        }
      />
    </div>
  );
}

function AddGiftState({ initial = 'open' }: { initial?: AddGiftStage }): ReactElement {
  const [stage, setStage] = useState<AddGiftStage>(initial);
  const base = S['add-gift'];
  const s: OrdScenario =
    stage === 'packed'
      ? { ...base, stage: 'packed', phase: { label: 'Spakowane', tone: 'success' } }
      : stage === 'document'
        ? { ...base, timeline: [...base.timeline, { at: '2026-11-04T08:20:00+01:00', title: 'Wystawiono paragon PAR/2026/11/0412', by: 'system · dokumenty', tone: 'success' }] }
        : base;
  return (
    <div className="v1o-stack">
      <VariantPicker
        value={stage}
        onChange={setStage}
        options={[
          { value: 'open', label: 'Paczka otwarta' },
          { value: 'document', label: 'Paragon już wystawiony' },
          { value: 'packed', label: 'Paczka zamknięta' },
        ]}
      />
      <OrderPage key={stage} s={s} giftStage={stage} giftOpen />
    </div>
  );
}

function MultipackState(): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const { go } = useProto();
  const [done, setDone] = useState(false);
  const base = S['multipack-held'];
  const s: OrdScenario = done
    ? {
        ...base,
        health: { label: 'Zsynchronizowane', tone: 'success' },
        phase: { label: 'Do spakowania', tone: 'info' },
        lines: [{ ...base.lines[0], kind: 'bundle', name: BUNDLES.triple.name, sku: BUNDLES.triple.sku, image: BUNDLES.triple.image, status: undefined, trail: undefined, version: 1 }, { id: 'L1~c:coffee', kind: 'component', variant: 'coffee', qty: 3, unitPrice: 0, partOf: BUNDLES.triple.name, status: { label: 'Zarezerwowano', tone: 'success' } }],
      }
    : base;
  return (
    <OrderPage
      s={s}
      banner={
        done ? (
          <Alert tone="success" title="Utworzono zestaw Kawa Etiopia, 3 opakowania">Zwolniono 2 wstrzymane zamówienia. Zarezerwowano 3 opakowania kawy.</Alert>
        ) : (
          <Alert
            tone="warning"
            title="Wstrzymane: oferta to 3 sztuki jednego produktu"
            action={
              <div className="button-group">
                <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => { setDone(true); showToast({ tone: 'success', title: 'Utworzono zestaw', description: 'Kawa Etiopia, 3 opakowania. Zwolniono 2 zamówienia.' }); }}>
                  Utwórz zestaw 3 x Kawa
                </Button>
                <Button tone="ghost" className="button--sm" onClick={() => go('products', 'form-new')}>Otwórz w produktach</Button>
              </div>
            }
          >
            Allegro sprzedało 3 opakowania kawy w jednej ofercie, a OpenLinker nie zna takiego zestawu. Bez niego ze stanu zeszłoby 1 opakowanie zamiast 3.
          </Alert>
        )
      }
    />
  );
}

type Problem = 'missing' | 'decrement' | 'zero-line';
function StockProblemState({ initial = 'missing' }: { initial?: Problem }): ReactElement {
  const [p, setP] = useState<Problem>(initial);
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [fixed, setFixed] = useState(false);
  const fix = (msg: string): void => {
    setFixed(true);
    showToast({ tone: 'success', title: 'Zdjęto stan ręcznie', description: msg });
  };
  const missing: OrdScenario = {
    ...S['bundle-edit-refused'],
    health: { label: 'Wymaga uwagi', tone: 'error' },
    phase: { label: 'Czeka: stan', tone: 'warning' },
    lines: S['bundle-edit-refused'].lines.map((l) =>
      l.variant === 'press' && l.kind === 'component'
        ? { ...l, status: { label: 'Brak na stanie', tone: 'error' as const }, trail: [{ label: 'Nie przydzielono do pakowania', state: 'blocked' as const, detail: 'French press: 0 szt. wolnych' }, { label: 'Przydzieli się samo po dostawie', state: 'todo' as const }] }
        : l,
    ),
  };
  const body: Record<Problem, { s: OrdScenario; tone: 'warning' | 'error'; title: string; text: string; action?: ReactNode }> = {
    missing: { s: missing, tone: 'warning', title: 'Zestaw czeka na French press', text: 'Kawa i herbata są zarezerwowane. Zamówienie trafi do pakowania samo, gdy French press wróci na stan.' },
    decrement: {
      s: S['decrement-blocked'],
      tone: 'error',
      title: 'Stan w PrestaShop nie zszedł',
      text: 'W PrestaShop "Zestaw do parzenia" jest pakiem, który sam zmniejsza stan składników. OpenLinker go nie zapisał, żeby nie zdjąć stanu dwa razy.',
      action: <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => fix('French press -1, Kawa -2 w PrestaShop.')}>Zdejmij stan ręcznie</Button>,
    },
    'zero-line': {
      s: S['destination-refused-zero-line'],
      tone: 'error',
      title: 'PrestaShop odrzucił gratis za 0,00 zł',
      text: 'Zamówienie powstało w sklepie bez łyżeczki. Pakowacz jej nie zobaczy, a stan nie zejdzie sam.',
      action: <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => fix('Łyżeczka do kawy -1 w PrestaShop, powód: gratis. Dodano notatkę dla pakowacza.')}>Zdejmij stan i dodaj notatkę</Button>,
    },
  };
  const x = body[p];
  return (
    <div className="v1o-stack">
      <VariantPicker
        value={p}
        onChange={(n) => { setP(n); setFixed(false); }}
        options={[
          { value: 'missing', label: 'Brak składnika' },
          { value: 'decrement', label: 'Stan nie zszedł' },
          { value: 'zero-line', label: 'Sklep odrzucił gratis' },
        ]}
      />
      <OrderPage
        key={p}
        s={x.s}
        banner={fixed ? <Alert tone="success" title="Zdjęto stan ręcznie">Zapisano w historii zamówienia i w ruchach magazynowych.</Alert> : <Alert tone={x.tone} title={x.title} action={x.action}>{x.text}</Alert>}
      />
    </div>
  );
}

function ShoperChildrenState(): ReactElement {
  const [show, setShow] = useState(false);
  return (
    <OrderPage
      s={S['shoper-double-children']}
      showIgnored={show}
      banner={
        <Alert tone="info" title="Shoper przysłał zestaw i jego składniki osobno" action={<Button tone="ghost" className="button--sm" onClick={() => setShow(!show)}>{show ? 'Ukryj pominięte' : 'Pokaż pominięte pozycje'}</Button>}>
          OpenLinker pominął 2 pozycje składników, żeby stan nie zszedł dwa razy.
        </Alert>
      }
    />
  );
}

function GiftWrapState(): ReactElement {
  const { go } = useProto();
  return (
    <OrderPage
      s={S['gift-wrap']}
      below={
        <DetailSection title="Pakowanie na prezent">
          <p className="v1o-item__note">Wiadomość od kupującego: "Wszystkiego najlepszego, Kasiu!"</p>
          <button type="button" className="v1o-link" onClick={() => go('bench', 'gift-wrap')}>Zobacz, co widzi pakowacz</button>
        </DetailSection>
      }
    />
  );
}

function CancelledState(): ReactElement {
  return (
    <OrderPage
      s={S.cancelled}
      banner={
        <Alert tone="info" title="Zamówienie anulowane">
          Rezerwacje zwolnione: kubek, kawa i łyżeczka (gratis). Nic nie zeszło ze stanu, bo paczki nie spakowano.
        </Alert>
      }
    />
  );
}

function EurState(): ReactElement {
  const { go } = useProto();
  return (
    <OrderPage
      s={S['eur-order']}
      banner={
        <Alert tone="warning" title="Dokument czeka: brak trasy dla EUR" action={<Button tone="ghost" className="button--sm" onClick={() => go('settings', 'default')}>Ustawienia dokumentów</Button>}>
          Erli przysłało EUR i stawki VAT Niemiec (19% i 7%). OpenLinker nie wystawi paragonu w PLN. Wystaw fakturę ręcznie. Docelowo OpenLinker wystawi fakturę OSS sam.
        </Alert>
      }
    />
  );
}

/* ── Registry ──────────────────────────────────────────────────────── */

const UNDER = {
  bundle: 'Pod spodem: integracja Allegro lub Erli przysyła zestaw jako jedną pozycję; OpenLinker sam rozkłada go na składniki do rezerwacji i pakowania.',
  gift: 'Pod spodem: OpenLinker dodaje gratis z promocji do zamówienia; integracja sklepu docelowego zapisuje go tam jako pozycję 0,00 zł, gdy pakuje sklep.',
  channel: 'Pod spodem: integracja kanału czyta, co kanał wie o gratisie (flaga, reguła koszyka, cena 0,01 zł), i podaje to w jednym polu; OpenLinker tylko to wyświetla.',
  stock: 'Pod spodem: zdjęcie stanu wykonuje integracja PrestaShop; OpenLinker pilnuje, żeby zestaw zszedł składnikami i tylko raz.',
};

const STATES: StateDef[] = [
  { id: 'bundle', label: 'Zestaw w zamówieniu', note: `Zestaw to jedna pozycja z wciętymi składnikami. Gratis w składzie widać raz, w swojej linii, z kosztem pod spodem. Wariant Allegro pokazuje zamówienie ze składem sprzed zmiany zestawu: informacja pojawia się tylko wtedy. "Zmień pozycje" mówi wprost, że zestawu nie zmienia się częściowo. ${UNDER.bundle}`, useCases: ['B-04', 'B-10', 'B-23', 'G-07', 'B-24', 'X-10'], priority: 'pilot', channels: ['allegro', 'erli'] },
  { id: 'gift-ol-only', label: 'Gratis tylko w OpenLinkerze', note: `Allegro nie zna gratisów, więc łyżeczkę dodała promocja w OpenLinkerze. Kliknij znacznik "Gratis", żeby zobaczyć źródło. Przełącznik OMS na górze pokazuje drugą drogę: bez OMS gratis idzie do PrestaShop jako pozycja 0,00 zł. Wariant "pilot" to notatka dla pakowacza i ręczne zdjęcie stanu. ${UNDER.gift}`, useCases: ['G-04', 'G-06', 'G-21', 'X-09', 'G-20'], priority: 'stage0', channels: ['allegro'] },
  { id: 'gift-from-channel', label: 'Gratis z kanału', note: `Ten sam widok dla czterech kanałów: reguła koszyka PrestaShop, flaga IdoSell i Empik, cena 0,01 zł w Shoperze. Różnica jest tylko w podpowiedzi na znaczniku. Surowe dane kanału są pod "Pokaż, co przysłał". ${UNDER.channel}`, useCases: ['G-01', 'G-02', 'G-03', 'X-01', 'X-07'], priority: 'pilot', channels: ['prestashop', 'idosell', 'empik', 'shoper'] },
  { id: 'gift-out-of-stock', label: 'Gratis bez stanu', note: `Jeden komunikat, trzy decyzje w nim. Promocja wstrzymuje się sama, gdy gratis się kończy, więc problem dotyczy tylko zamówień złożonych przed tą chwilą. ${UNDER.gift}`, useCases: ['G-08', 'G-16'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-not-added', label: 'Dlaczego gratisu nie ma', note: 'Cztery powody w jednym miejscu: dwie promocje (dodano tę wyżej na liście), limit sztuk, limit na klienta, spadek poniżej progu po zmianie. Zawsze jedno zdanie i link do promocji. Szczegóły zostają w historii.', useCases: ['G-06', 'X-06', 'G-16', 'G-15', 'X-04'], priority: 'pilot', channels: ['allegro', 'woocommerce'] },
  { id: 'add-gift', label: 'Dodaj gratis ręcznie', note: 'Produkt, ilość, opcjonalny powód i jedna linia kosztu. Dozwolone do zamknięcia paczki. Gdy paragon już jest, jedno ostrzeżenie: na paragonie gratisu nie będzie. Po zamknięciu paczki odmowa z radą, co zrobić.', useCases: ['G-05', 'X-04', 'D-05'], priority: 'pilot', channels: ['allegro'] },
  { id: 'multipack-held', label: 'Multipak wstrzymany', note: `Oferta Allegro to 3 opakowania jednego produktu, a OpenLinker nie zna takiego zestawu. Jeden przycisk tworzy zestaw i zwalnia wszystkie wstrzymane zamówienia. ${UNDER.bundle}`, useCases: ['B-08'], priority: 'stage0', channels: ['allegro'] },
  { id: 'stock-problem', label: 'Problem ze stanem', note: `Ścieżka stanu pojawia się tylko tutaj, przy pozycji z problemem. Trzy przypadki: składnika brak (zamówienie czeka samo), pak PrestaShop blokuje zdjęcie stanu, sklep odrzucił gratis 0,00 zł. ${UNDER.stock}`, useCases: ['B-12', 'B-23', 'B-20', 'B-22', 'G-04', 'G-20'], priority: 'pilot', channels: ['allegro', 'prestashop'] },
  { id: 'shoper-children', label: 'Shoper: składniki osobno', note: 'Shoper przysyła zestaw i jego składniki jako osobne pozycje. Pominięte pozycje są schowane, a komunikat mówi dlaczego. Pod spodem: integracja Shoper oznacza pozycje-dzieci, OpenLinker ich nie liczy do stanu.', useCases: ['B-05'], priority: 'pilot', channels: ['shoper'] },
  { id: 'gift-wrap', label: 'Pakowanie na prezent', note: 'Płatna usługa to zwykła pozycja bez stanu. Wiadomość od kupującego trafia na stanowisko pakowania.', useCases: ['G-14', 'D-05', 'X-05'], priority: 'later', channels: ['allegro'] },
  { id: 'cancelled', label: 'Anulowane', note: 'Jedno zdanie: rezerwacje zwolnione, w tym gratis, i nic nie zeszło ze stanu.', useCases: ['B-24', 'G-21'], priority: 'pilot', channels: ['allegro'] },
  { id: 'eur-order', label: 'Zamówienie w EUR', note: 'Erli przysłało EUR i niemiecki VAT. Dokument czeka w ogólnej blokadzie "brak trasy dokumentu". Docelowo automatyczna faktura OSS.', useCases: ['X-08'], priority: 'later', channels: ['erli'] },
  { id: 'viewer', label: 'Tylko do odczytu', note: 'Użytkownik bez uprawnień widzi wszystko, ale "Dodaj gratis" jest wyłączony z powodem w podpowiedzi.', useCases: [], priority: 'pilot' },
  ...commonStates('zamówienia', 'wróć do listy zamówień'),
];

/** Old app4 ids still linked from elsewhere map to the new simple states. */
const ALIAS: Record<string, () => ReactElement> = {
  'bundle-allegro': () => <BundleState initial="allegro" />,
  'bundle-plus-gift': () => <BundleState />,
  'bundle-edit-refused': () => <BundleState />,
  'pilot-mode': () => <GiftOlOnlyState />,
  'gift-cart-rule': () => <GiftFromChannelState initial="prestashop" />,
  'gift-channel-flag': () => <GiftFromChannelState initial="idosell" />,
  'gift-inferred': () => <GiftFromChannelState initial="shoper" />,
  'two-rules-matched': () => <GiftNotAddedState initial="two" />,
  'limit-reached': () => <GiftNotAddedState initial="limit" />,
  'customer-limit-reached': () => <GiftNotAddedState initial="customer" />,
  'gift-removed-below-threshold': () => <GiftNotAddedState initial="threshold" />,
  'add-gift-before-packing': () => <AddGiftState initial="open" />,
  'add-gift-after-invoice': () => <AddGiftState initial="document" />,
  'add-gift-after-packing': () => <AddGiftState initial="packed" />,
  'routing-refused': () => <StockProblemState initial="missing" />,
  'decrement-blocked': () => <StockProblemState initial="decrement" />,
  'destination-refused-zero-line': () => <StockProblemState initial="zero-line" />,
  'shoper-double-children': () => <ShoperChildrenState />,
};

function render(state: string): ReactElement {
  switch (state) {
    case 'bundle':
      return <BundleState />;
    case 'gift-ol-only':
      return <GiftOlOnlyState />;
    case 'gift-from-channel':
      return <GiftFromChannelState />;
    case 'gift-out-of-stock':
      return <GiftOutOfStockState />;
    case 'gift-not-added':
      return <GiftNotAddedState />;
    case 'add-gift':
      return <AddGiftState />;
    case 'multipack-held':
      return <MultipackState />;
    case 'stock-problem':
      return <StockProblemState />;
    case 'shoper-children':
      return <ShoperChildrenState />;
    case 'gift-wrap':
      return <GiftWrapState />;
    case 'cancelled':
      return <CancelledState />;
    case 'eur-order':
      return <EurState />;
    case 'viewer':
      return <BundleState readOnly />;
    default:
      return ALIAS[state] ? ALIAS[state]() : <BundleState />;
  }
}

export const screen: ScreenDef = {
  id: 'order',
  group: 'Sprzedaż',
  label: 'Szczegóły zamówienia',
  states: STATES,
  render,
};
