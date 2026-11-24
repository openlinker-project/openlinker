/**
 * Promocje z gratisem (catalogue): the list of OpenLinker gift rules and a
 * composer for one rule (trigger, conditions, gift, combining, unit cap,
 * out-of-stock policy, "where this works" per channel, dry run). Rules are
 * checked in list order; there are no priority numbers and no money budget.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { DetailSection } from '@web/shared/ui/detail-section';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { FilterCheck, FilterChecks } from '@web/shared/ui/filter-check';
import { Infotip } from '@web/shared/ui/infotip';
import { useToast } from '@web/shared/ui/toast-provider';
import { CHANNELS, PROMOTIONS, VARIANTS, type ChannelId, type Promotion, type StockPolicy } from '../model/catalog';
import { SMALL_GIFT_UNIT_LIMIT } from '../model/calc';
import { EUR_RATE, commonStates, useMoney, useProto, useWriteGuard, type ScreenDef } from '../proto';
import { GiftMark, StockPathTrail, Switch, WhoPaysStrip } from '../ui/marks';
import { ALL_CHANNELS, NO_COST_PROMO, STATUS_LABEL, STATUS_TONE, formatDate, giftWhere, shortName } from './cfg-data';
import './cfg.css';

type Scenario =
  | 'list'
  | 'composer-draft'
  | 'active'
  | 'paused'
  | 'limit-reached'
  | 'ended'
  | 'edited-open-orders'
  | 'gift-out-of-stock'
  | 'gift-no-cost'
  | 'dry-run-two-match'
  | 'per-customer-limit'
  | 'skip-if-present';

const byId = (id: string): Promotion => PROMOTIONS.find((p) => p.id === id) ?? PROMOTIONS[0];

function promoFor(s: Scenario): Promotion {
  switch (s) {
    case 'composer-draft':
      return byId('promo-xmas');
    case 'active':
    case 'edited-open-orders':
    case 'skip-if-present':
      return byId('promo-spoon');
    case 'dry-run-two-match':
      return byId('promo-sample');
    case 'paused':
      return { ...byId('promo-spoon'), status: 'paused' };
    case 'limit-reached':
      return byId('promo-bag');
    case 'ended':
      return byId('promo-oct');
    case 'gift-out-of-stock':
    case 'per-customer-limit':
      return byId('promo-sample');
    case 'gift-no-cost':
      return NO_COST_PROMO;
    default:
      return byId('promo-spoon');
  }
}

const STATE_OF: Record<string, Scenario> = {
  'promo-spoon': 'active',
  'promo-sample': 'gift-out-of-stock',
  'promo-bag': 'limit-reached',
  'promo-xmas': 'composer-draft',
  'promo-oct': 'ended',
};

const giftAvail = (k: string): number => Math.max(0, VARIANTS[k].stock - VARIANTS[k].held);

/** Position on the list (1 = checked first). */
const placeOf = (id: string): number => {
  const i = PROMOTIONS.findIndex((p) => p.id === id);
  return i < 0 ? PROMOTIONS.length + 1 : i + 1;
};

function CapBar({ given, cap }: { given: number; cap: number | null }): ReactElement {
  if (cap === null) return <span className="cfg-muted tabular">bez limitu, do wyczerpania stanu · wydano {given} szt.</span>;
  const ratio = Math.min(1, cap ? given / cap : 0);
  return (
    <span className="cfg-bar">
      <span className="cfg-bar__track" aria-hidden="true">
        <span className={`cfg-bar__fill${ratio >= 1 ? ' cfg-bar__fill--full' : ''}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      <span className="cfg-bar__label tabular">
        {given} z {cap} szt.
      </span>
    </span>
  );
}

function ChannelNames({ ids }: { ids: ChannelId[] }): ReactElement {
  return (
    <span className="cfg-channels">
      {ids.map((id) => (
        <span key={id} className="cfg-channel">
          <span className="cfg-channel__dot" style={{ background: `var(${CHANNELS[id].colorVar})` }} aria-hidden="true" />
          {CHANNELS[id].name}
        </span>
      ))}
    </span>
  );
}

/* ── List ───────────────────────────────────────────────────────────── */

function PromotionList(): ReactElement {
  const money = useMoney();
  const { go } = useProto();
  const { showToast } = useToast();
  const { canWrite, reason } = useWriteGuard();
  const [rows, setRows] = useState<Promotion[]>(PROMOTIONS);
  const move = (id: string, dir: -1 | 1): void => {
    setRows((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      showToast({ tone: 'success', description: `Przesunięto "${list[i].name}" na miejsce ${j + 1}.` });
      return next;
    });
  };
  const columns: DataTableColumn<Promotion>[] = [
    {
      id: 'place',
      header: 'Kolejność',
      cell: (p) => {
        const i = rows.findIndex((r) => r.id === p.id);
        return (
          <span className="cfg-row">
            <span className="cfg-strong tabular">{i + 1}</span>
            <Button tone="ghost" disabled={!canWrite || i === 0} title={!canWrite ? reason : undefined} aria-label={`Przesuń ${p.name} wyżej`} onClick={() => move(p.id, -1)}>
              Wyżej
            </Button>
            <Button tone="ghost" disabled={!canWrite || i === rows.length - 1} title={!canWrite ? reason : undefined} aria-label={`Przesuń ${p.name} niżej`} onClick={() => move(p.id, 1)}>
              Niżej
            </Button>
          </span>
        );
      },
    },
    {
      id: 'name',
      header: 'Promocja',
      cell: (p) => (
        <span className="cfg-cell-stack cfg-cell-stack--start">
          <button type="button" className="cfg-link cfg-strong" onClick={() => go('promotions', STATE_OF[p.id] ?? 'active')}>
            {p.name}
          </button>
          <span className="cfg-muted tabular">
            {p.stackable ? 'łączy się z innymi' : 'nie łączy się z innymi'} · v{p.version}
          </span>
        </span>
      ),
    },
    { id: 'status', header: 'Stan', cell: (p) => <StatusBadge tone={STATUS_TONE[p.status]} compact withDot>{STATUS_LABEL[p.status]}</StatusBadge> },
    {
      id: 'gift',
      header: 'Gratis',
      cell: (p) => (
        <span className="cfg-cell-stack cfg-cell-stack--start">
          <GiftMark compact />
          <span>
            {p.giftQty} x {shortName(p.gift)}
            {p.perUnit ? (p.perN > 1 ? ` na każde ${p.perN} szt.` : ' na każdą sztukę') : ''}
          </span>
          {giftAvail(p.gift) === 0 ? <span className="cfg-comps__flag cfg-comps__flag--error">brak na stanie</span> : null}
        </span>
      ),
    },
    { id: 'channels', header: 'Kanały', hideBelow: 1024, cell: (p) => <ChannelNames ids={p.channels} /> },
    {
      id: 'period',
      header: 'Okres',
      hideBelow: 768,
      cell: (p) => (
        <span className="tabular">
          {formatDate(p.from)} - {formatDate(p.to)}
        </span>
      ),
    },
    { id: 'cap', header: 'Limit sztuk', cell: (p) => <CapBar given={p.given} cap={p.unitCap} /> },
    { id: 'cost', header: 'Koszt dotąd', align: 'right', hideBelow: 1024, cell: (p) => <span className="tabular">{money(p.spent, 'PLN')}</span> },
  ];
  const active = rows.filter((p) => p.status === 'active').length;
  return (
    <PageLayout
      title="Promocje z gratisem"
      description="Reguły, które dodają gratis do zamówienia przy przyjęciu. Działają w każdym kanale, także tam, gdzie kanał nie zna gratisów."
      actions={
        <Button disabled={!canWrite} title={reason} onClick={() => go('promotions', 'composer-draft')}>
          Utwórz promocję
        </Button>
      }
    >
      <div className="cfg-stack">
        <div className="cfg-kpis">
          <div className="detail-card">
            <p className="cfg-muted">Aktywne</p>
            <p className="cfg-strong tabular" style={{ fontSize: 22, margin: 0 }}>{active}</p>
          </div>
          <div className="detail-card">
            <p className="cfg-muted">Gratisy wydane w tym miesiącu</p>
            <p className="cfg-strong tabular" style={{ fontSize: 22, margin: 0 }}>160 szt.</p>
          </div>
          <div className="detail-card">
            <p className="cfg-muted">Koszt gratisów w tym miesiącu</p>
            <p className="cfg-strong tabular" style={{ fontSize: 22, margin: 0 }}>{money(52800, 'PLN')}</p>
          </div>
        </div>
        <Alert tone="warning" density="compact" title="Próbka kawy skończyła się, promocja wstrzymała się sama" action={<Button tone="secondary" onClick={() => go('promotions', 'gift-out-of-stock')}>Zobacz promocję</Button>}>
          Zamówienia idą dalej bez próbki i dostają uwagę "Gratis bez stanu". Promocja wznowi się, gdy próbka wróci na stan.
        </Alert>
        <p className="cfg-secondary">
          OpenLinker sprawdza promocje od góry listy. Gdy pasuje promocja, która nie łączy się z innymi, niższe już nie dochodzą. Promocje, które się łączą, dodają swoje gratisy razem.
        </p>
        <DataTable
          caption="Promocje z gratisem, w kolejności sprawdzania"
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          cardView={{
            title: (p) => p.name,
            subtitle: (p) => `${formatDate(p.from)} - ${formatDate(p.to)}`,
            meta: (p) => <StatusBadge tone={STATUS_TONE[p.status]} compact withDot>{STATUS_LABEL[p.status]}</StatusBadge>,
            summary: (p) => (
              <span className="cfg-stack cfg-stack--tight">
                <span className="cfg-row">
                  <GiftMark compact />
                  <span>
                    {p.giftQty} x {shortName(p.gift)}
                  </span>
                </span>
                <ChannelNames ids={p.channels} />
                <CapBar given={p.given} cap={p.unitCap} />
                <span className="cfg-muted tabular">miejsce {rows.findIndex((r) => r.id === p.id) + 1} na liście</span>
              </span>
            ),
            actions: (p) => (
              <Button tone="secondary" onClick={() => go('promotions', STATE_OF[p.id] ?? 'active')}>
                Otwórz
              </Button>
            ),
          }}
        />
      </div>
    </PageLayout>
  );
}

/* ── Dry run ────────────────────────────────────────────────────────── */

interface SampleOrder {
  id: string;
  label: string;
  channel: ChannelId;
  total: number;
  skus: string[];
  qtyBySku: Record<string, number>;
  /** Rules this customer already got a gift from. */
  priorGifts: string[];
  /** Gift products already in the order, e.g. as a bundle component. */
  present: string[];
  customerNote: string;
}

const SAMPLE_ORDERS: SampleOrder[] = [
  { id: 'o1', label: 'Allegro ALG-7821: Zestaw poranny + 3 x kawa Etiopia, 179,96 zł', channel: 'allegro', total: 17996, skus: ['ZES-PORANNY', 'KAW-250-ETI'], qtyBySku: { 'ZES-PORANNY': 1, 'KAW-250-ETI': 3 }, priorGifts: [], present: [], customerNote: 'Kupujący Allegro 48213, pierwsze zamówienie' },
  { id: 'o2', label: 'PrestaShop 1042: 2 x kubek, 79,98 zł', channel: 'prestashop', total: 7998, skus: ['KUB-350-BI'], qtyBySku: { 'KUB-350-BI': 2 }, priorGifts: [], present: [], customerNote: 'anna.kowalska@example.pl, tel. 600 100 200' },
  { id: 'o3', label: 'Allegro ALG-7830: 5 x kawa Etiopia, 174,95 zł', channel: 'allegro', total: 17495, skus: ['KAW-250-ETI'], qtyBySku: { 'KAW-250-ETI': 5 }, priorGifts: ['promo-sample'], present: [], customerNote: 'Kupujący Allegro 48213, gratis z tej promocji 12 paź' },
  { id: 'o4', label: 'Allegro ALG-7844: Zestaw poranny v2 (łyżeczka już w składzie), 89,99 zł', channel: 'allegro', total: 8999, skus: ['ZES-PORANNY'], qtyBySku: { 'ZES-PORANNY': 1 }, priorGifts: [], present: ['spoon'], customerNote: 'Kupujący Allegro 51077, pierwsze zamówienie' },
];

interface DryResult {
  promo: Promotion;
  matched: boolean;
  outcome: string;
  tone: 'success' | 'neutral' | 'warning' | 'error';
  why: string;
}

function evaluate(order: SampleOrder, edited: Promotion): DryResult[] {
  const rules = PROMOTIONS.map((p) => (p.id === edited.id ? edited : p));
  if (!rules.some((p) => p.id === edited.id)) rules.push(edited);
  const place = (p: Promotion): number => rules.findIndex((r) => r.id === p.id) + 1;
  const cands: DryResult[] = rules.map((p) => {
    const reasons: string[] = [];
    if (!p.channels.includes(order.channel)) reasons.push(`kanał ${CHANNELS[order.channel].name} nie jest w promocji`);
    if (p.minBasket !== null && order.total < p.minBasket) reasons.push(`koszyk poniżej ${(p.minBasket / 100).toFixed(0)} zł`);
    if (p.containsSku && !order.skus.includes(p.containsSku)) reasons.push(`brak ${p.containsSku} w koszyku`);
    const isEdited = p.id === edited.id;
    if (reasons.length) return { promo: p, matched: false, outcome: 'Nie pasuje', tone: 'neutral', why: reasons.join(', ') };
    if (!isEdited && p.status === 'ended') return { promo: p, matched: false, outcome: 'Zakończona', tone: 'neutral', why: 'Okres promocji minął.' };
    if (!isEdited && p.status === 'draft') return { promo: p, matched: false, outcome: 'Szkic', tone: 'neutral', why: 'Szkic nie działa na zamówieniach.' };
    if (!isEdited && p.status === 'paused') return { promo: p, matched: true, outcome: 'Wstrzymana', tone: 'warning', why: 'Pasuje, ale jest wstrzymana.' };
    if (!isEdited && p.status === 'out-of-stock') return { promo: p, matched: true, outcome: 'Wstrzymana: brak gratisu', tone: 'warning', why: 'Pasuje, ale gratisu nie ma na stanie, więc promocja wstrzymała się sama. Zamówienie dostanie uwagę "Gratis bez stanu".' };
    if (p.status === 'limit-reached' || (p.unitCap !== null && p.given >= p.unitCap)) return { promo: p, matched: true, outcome: 'Pominięta: limit sztuk', tone: 'warning', why: `Pasuje, ale wydano już ${p.given} z ${p.unitCap ?? p.given} szt. Promocja wstrzymała się sama.` };
    if (p.skipIfPresent && order.present.includes(p.gift)) return { promo: p, matched: true, outcome: 'Pominięta: produkt już w zamówieniu', tone: 'neutral', why: `${shortName(p.gift)} jest już w zamówieniu jako składnik zestawu, a promocja ma zaznaczone "Pomiń, jeśli produkt jest już w zamówieniu".` };
    if (p.perCustomerLimit !== null && order.priorGifts.includes(p.id)) return { promo: p, matched: true, outcome: 'Pominięta: limit klienta', tone: 'warning', why: 'Ten klient dostał już gratis z tej promocji.' };
    return { promo: p, matched: true, outcome: 'Pasuje', tone: 'success', why: isEdited && p.status !== 'active' ? 'Test traktuje tę regułę jak aktywną.' : 'Wszystkie warunki spełnione.' };
  });
  const eligible = cands.filter((c) => c.outcome === 'Pasuje').sort((a, b) => place(a.promo) - place(b.promo));
  const applied: Promotion[] = [];
  for (const c of eligible) {
    const ok = applied.length === 0 || (c.promo.stackable && applied.every((a) => a.stackable));
    if (ok) {
      applied.push(c.promo);
      const avail = giftAvail(c.promo.gift);
      const q = c.promo.perUnit && c.promo.containsSku ? order.qtyBySku[c.promo.containsSku] ?? 1 : 1;
      const raw = c.promo.giftQty * (c.promo.perUnit ? Math.floor(q / Math.max(1, c.promo.perN)) : 1);
      const need = c.promo.maxPerOrder !== null ? Math.min(raw, c.promo.maxPerOrder) : raw;
      if (avail < need) {
        c.outcome = c.promo.policy === 'substitute' ? 'Zastosowana: zamiennik' : c.promo.policy === 'hold-order' ? 'Wstrzymuje zamówienie' : 'Pominięta: brak stanu';
        c.tone = 'warning';
        c.why = `Gratisu jest ${avail} szt., potrzeba ${need}. ${c.promo.policy === 'substitute' ? `Wyda zamiennik: ${shortName(c.promo.substitute ?? 'bag')}.` : c.promo.policy === 'hold-order' ? 'Zamówienie czeka na dostawę gratisu.' : 'Zamówienie idzie dalej bez gratisu, z uwagą "Gratis bez stanu".'}`;
      } else {
        c.outcome = 'Zastosowana';
        c.why = `Dodaje ${need} x ${shortName(c.promo.gift)} do zamówienia.`;
      }
    } else {
      const top = applied[0];
      c.outcome = 'Pominięta: niżej na liście';
      c.tone = 'neutral';
      c.why = !c.promo.stackable
        ? `Ta promocja nie łączy się z innymi, a wyżej na liście zastosowano "${top.name}".`
        : `"${top.name}" jest wyżej na liście (miejsce ${place(top)}) i nie łączy się z innymi.`;
    }
  }
  return cands.sort((a, b) => Number(b.matched) - Number(a.matched) || place(a.promo) - place(b.promo));
}

function DryRun({ edited, initial }: { edited: Promotion; initial: string | null }): ReactElement {
  const [orderId, setOrderId] = useState(initial ?? 'o1');
  const [ran, setRan] = useState(initial !== null);
  const order = SAMPLE_ORDERS.find((o) => o.id === orderId) ?? SAMPLE_ORDERS[0];
  const results = evaluate(order, edited);
  const matched = results.filter((r) => r.matched).length;
  const applied = results.filter((r) => r.outcome.startsWith('Zastosowana')).length;
  return (
    <DetailSection title="Test na przykładowym zamówieniu" titleAside={<span className="cfg-muted">nic nie zapisuje</span>}>
      <div className="cfg-dry">
        <div className="cfg-add">
          <FormField label="Zamówienie" name="dry-order">
            <Select value={orderId} onChange={(e) => { setOrderId(e.target.value); setRan(false); }}>
              {SAMPLE_ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <Button tone="secondary" onClick={() => setRan(true)}>
            Sprawdź promocje
          </Button>
        </div>
        <p className="cfg-muted">Klient: {order.customerNote}</p>
        {ran ? (
          <>
            <Alert tone={matched > 1 ? 'info' : 'success'} density="compact" title={`Pasuje ${matched} ${matched === 1 ? 'reguła' : 'reguły'}, zastosowano ${applied}`}>
              {matched > 1 ? 'OpenLinker sprawdza promocje od góry listy. Pierwsza pasująca, która nie łączy się z innymi, wygrywa. Promocje, które się łączą, dochodzą do siebie.' : 'Wynik pokazuje, co OpenLinker zrobiłby z tym zamówieniem przy przyjęciu.'}
            </Alert>
            <div className="cfg-scroll">
              <table className="cfg-table">
                <caption className="sr-only">Wynik testu reguł</caption>
                <thead>
                  <tr>
                    <th scope="col">Reguła</th>
                    <th scope="col" className="cfg-right">Miejsce na liście</th>
                    <th scope="col">Wynik</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.promo.id} className={r.outcome.startsWith('Zastosowana') ? 'cfg-row--limit' : undefined}>
                      <th scope="row">
                        {r.promo.name}
                        {r.promo.id === edited.id ? <span className="spike-note">ta reguła</span> : null}
                      </th>
                      <td className="cfg-right tabular">{PROMOTIONS.findIndex((x) => x.id === r.promo.id) + 1 || PROMOTIONS.length + 1}</td>
                      <td>
                        <span className="cfg-stack cfg-stack--tight">
                          <StatusBadge tone={r.tone} compact withDot>{r.outcome}</StatusBadge>
                          <span className="cfg-muted">{r.why}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </DetailSection>
  );
}

/* ── Composer ───────────────────────────────────────────────────────── */

function WhereMatrix({ selected }: { selected: ChannelId[] }): ReactElement {
  return (
    <DetailSection title="Gdzie to działa">
      <p className="cfg-secondary">Gratis zawsze trafia do zamówienia w OpenLinkerze. To, czy klient go widzi w kanale, zależy od kanału.</p>
      <div className="cfg-scroll">
        <table className="cfg-table">
          <caption className="sr-only">Działanie gratisu w kanałach</caption>
          <thead>
            <tr>
              <th scope="col">Kanał</th>
              <th scope="col">Jak działa</th>
              <th scope="col">Co widzi klient</th>
              <th scope="col">Co robi OpenLinker</th>
            </tr>
          </thead>
          <tbody>
            {ALL_CHANNELS.map((id) => {
              const w = giftWhere(id);
              const on = selected.includes(id);
              return (
                <tr key={id} style={on ? undefined : { opacity: 0.55 }}>
                  <th scope="row">
                    {CHANNELS[id].name}
                    <span className="spike-note">{on ? 'w promocji' : 'nie wybrano'}</span>
                  </th>
                  <td>
                    <StatusBadge tone={w.tone} compact>{w.label}</StatusBadge>
                  </td>
                  <td className="cfg-muted">{w.buyerSees}</td>
                  <td className="cfg-muted">
                    {w.warehouse}
                    {id === 'prestashop' ? ' Zalecamy: niech gratis dodaje OpenLinker.' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

function ScenarioBanner({ scenario, promo }: { scenario: Scenario; promo: Promotion }): ReactElement | null {
  const money = useMoney();
  const { go } = useProto();
  switch (scenario) {
    case 'paused':
      return (
        <Alert tone="warning" title="Promocja wstrzymana">
          Wstrzymana 3 lis przez Annę Nowak. Nowe zamówienia nie dostają gratisu. Zamówienia, które już mają gratis, zachowują go.
        </Alert>
      );
    case 'limit-reached':
      return (
        <Alert tone="warning" title="Limit sztuk wyczerpany, promocja wstrzymała się sama">
          Wydano {promo.given} z {promo.unitCap} szt. Od 28 paź nowe zamówienia nie dostają torby i nie mają z tego powodu uwagi, bo tak ustawiłeś limit. Podnieś limit, żeby wznowić.
        </Alert>
      );
    case 'ended':
      return (
        <Alert tone="info" title="Promocja zakończona 31 paź">
          Wydano {promo.given} gratisów za {money(promo.spent, 'PLN')}. Możesz przedłużyć daty i wznowić albo skopiować promocję na kolejny okres. Zamówienia z gratisem trzymają własną kopię promocji, więc zmiana ich nie ruszy.
        </Alert>
      );
    case 'edited-open-orders':
      return (
        <Alert tone="info" title={`Edytujesz wersję ${promo.version}. ${promo.openOrdersOnOldVersion} otwarte zamówienia trzymają v1`}>
          Te zamówienia mają już gratis według wersji 1 i go zachowają. Zmiany działają na zamówienia przyjęte po zapisie.
        </Alert>
      );
    case 'gift-out-of-stock':
      return (
        <Alert tone="warning" title="Próbka kawy: 0 szt. na stanie, promocja wstrzymała się sama" action={<Button tone="secondary" onClick={() => go('orders')}>Zobacz zamówienia</Button>}>
          Od 2 lis 14 zamówień poszło dalej bez gratisu i ma uwagę "Gratis bez stanu". Promocja wznowi się sama, gdy próbka wróci na stan. Możesz też ustawić zamiennik.
        </Alert>
      );
    case 'gift-no-cost':
      return (
        <Alert tone="info" title="Młynek ręczny nie ma kosztu zakupu">
          Promocję możesz aktywować. W analityce koszt tych gratisów będzie nieznany, dopóki nie uzupełnisz kosztu zakupu wariantu w katalogu.
        </Alert>
      );
    default:
      return null;
  }
}

function Composer({ scenario }: { scenario: Scenario }): ReactElement {
  const money = useMoney();
  const { go, oms, currency } = useProto();
  const { showToast } = useToast();
  const { canWrite, reason } = useWriteGuard();
  const base = promoFor(scenario);
  const [p, setP] = useState<Promotion>(() => ({ ...base }));
  const set = (patch: Partial<Promotion>): void => setP((x) => ({ ...x, ...patch }));
  const ro = !canWrite;
  const roReason = !canWrite ? reason : undefined;
  const place = placeOf(base.id);

  const v = VARIANTS[p.gift];
  const unitCost = v.cost;
  const estimate = unitCost === null || p.unitCap === null ? null : unitCost * p.unitCap;
  const avail = giftAvail(p.gift);
  const allegroIn = p.channels.includes('allegro') || p.channels.includes('erli');
  const toast = (title: string, description: string) => showToast({ title, description, tone: 'success' });
  const copyBtn = (
    <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Skopiowano promocję', `Nowy szkic "${p.name} (kopia)" na końcu listy.`)}>
      Kopiuj
    </Button>
  );

  let actions: ReactNode;
  if (base.status === 'draft')
    actions = (
      <>
        <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Zapisano szkic', `${p.name}: szkic zapisany.`)}>
          Zapisz szkic
        </Button>
        <Button disabled={!canWrite} title={reason} onClick={() => toast('Aktywowano promocję', `${p.name} działa od ${formatDate(p.from)}.`)}>
          Aktywuj promocję
        </Button>
      </>
    );
  else if (base.status === 'active')
    actions = (
      <>
        {copyBtn}
        <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Wstrzymano promocję', 'Nowe zamówienia nie dostaną gratisu.')}>
          Wstrzymaj promocję
        </Button>
        <Button disabled={!canWrite} title={reason} onClick={() => toast('Zapisano zmiany', `Zapisano wersję ${p.version + 1}. Otwarte zamówienia zachowują swój gratis.`)}>
          Zapisz zmiany
        </Button>
      </>
    );
  else if (base.status === 'paused')
    actions = (
      <Button disabled={!canWrite} title={reason} onClick={() => toast('Wznowiono promocję', 'Nowe zamówienia znowu dostają gratis.')}>
        Wznów promocję
      </Button>
    );
  else if (base.status === 'limit-reached') {
    const raised = p.unitCap === null || p.unitCap > p.given;
    actions = (
      <Button disabled={!canWrite || !raised} title={!canWrite ? reason : !raised ? `Ustaw limit powyżej ${p.given} szt. albo usuń limit.` : undefined} onClick={() => toast('Wznowiono promocję', p.unitCap === null ? 'Promocja działa do wyczerpania stanu.' : `Limit ${p.unitCap} szt., promocja znowu działa.`)}>
        Podnieś limit i wznów
      </Button>
    );
  } else if (base.status === 'out-of-stock')
    actions = (
      <>
        {copyBtn}
        <Button disabled={!canWrite} title={reason} onClick={() => toast('Zapisano zmiany', 'Promocja wznowi się sama, gdy gratis wróci na stan.')}>
          Zapisz zmiany
        </Button>
      </>
    );
  else {
    const extended = p.to > base.to;
    actions = (
      <>
        {copyBtn}
        <Button disabled={!canWrite || !extended} title={!canWrite ? reason : !extended ? 'Ustaw datę "Do" późniejszą niż 31 paź.' : undefined} onClick={() => toast('Wznowiono promocję', `Promocja działa do ${formatDate(p.to)}.`)}>
          Przedłuż i wznów
        </Button>
      </>
    );
  }

  return (
    <PageLayout
      eyebrow="Promocje z gratisem"
      title={
        <span className="cfg-row">
          <span>{p.name}</span>
          <StatusBadge tone={STATUS_TONE[base.status]} withDot>{STATUS_LABEL[base.status]}</StatusBadge>
        </span>
      }
      description={`Wersja ${p.version}. Wydano ${p.given} gratisów.`}
      actions={
        <span className="cfg-actions">
          <Button tone="ghost" onClick={() => go('promotions', 'list')}>
            Wróć do listy
          </Button>
          {actions}
        </span>
      }
    >
      <div className="cfg-stack">
        <ScenarioBanner scenario={scenario} promo={base} />

        <DetailSection title="Kiedy">
          <div className="cfg-fields cfg-fields--2">
            <FormField label="Nazwa" name="promo-name">
              <Input value={p.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} />
            </FormField>
            <FormField label="Wyzwalacz" name="promo-trigger" description="Reguła sprawdza zamówienie raz, przy przyjęciu, zanim powstaną rezerwacje.">
              <span className="cfg-row">
                <Input value="Zamówienie przyjęte" readOnly aria-readonly="true" />
                <Infotip ariaLabel="O wyzwalaczu" definitions={[{ term: 'Zamówienie przyjęte', text: 'Uruchamia się, gdy zamówienie jest gotowe w OpenLinkerze. Gratis dodany później, po skierowaniu do magazynu albo po spakowaniu, jest za późno: wtedy dodaj go ręcznie i popraw stan.' }]} />
              </span>
            </FormField>
          </div>
        </DetailSection>

        <DetailSection title="Warunki">
          <div className="cfg-stack">
            <fieldset className="cfg-stack cfg-stack--tight" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="cfg-strong" style={{ fontSize: 13, marginBottom: 6 }}>Kanały sprzedaży</legend>
              <FilterChecks aria-label="Kanały sprzedaży">
                {ALL_CHANNELS.map((id) => (
                  <FilterCheck
                    key={id}
                    label={CHANNELS[id].name}
                    checked={p.channels.includes(id)}
                    disabled={ro}
                    onChange={(e) => set({ channels: e.target.checked ? [...p.channels, id] : p.channels.filter((c) => c !== id) })}
                  />
                ))}
              </FilterChecks>
            </fieldset>
            <div className="cfg-fields cfg-fields--2">
              <FormField label="Wartość koszyka od (zł)" name="promo-basket">
                <Input inputMode="decimal" value={p.minBasket === null ? '' : String(p.minBasket / 100)} disabled={ro} placeholder="bez progu" onChange={(e) => set({ minBasket: e.target.value ? Math.round(Number(e.target.value.replace(',', '.')) * 100) : null })} />
              </FormField>
              <FormField label="Koszyk zawiera SKU albo ofertę" name="promo-sku">
                <Input value={p.containsSku ?? ''} disabled={ro} placeholder="np. ZES-PORANNY" onChange={(e) => set({ containsSku: e.target.value || null })} />
              </FormField>
              <FormField label="Od" name="promo-from">
                <Input type="date" value={p.from} disabled={ro} onChange={(e) => set({ from: e.target.value })} />
              </FormField>
              <FormField label="Do" name="promo-to">
                <Input type="date" value={p.to} disabled={ro} onChange={(e) => set({ to: e.target.value })} />
              </FormField>
            </div>
            <p className="cfg-secondary">
              Liczy się data złożenia zamówienia w kanale. Promocja nie działa wstecz: zamówienie złożone przed aktywacją nie dostanie gratisu, nawet jeśli trafi do OpenLinkera później.
            </p>
            <div className="cfg-stack cfg-stack--tight">
              <FilterCheck
                label="Pomiń, jeśli produkt jest już w zamówieniu (także jako składnik zestawu)"
                checked={p.skipIfPresent}
                disabled={ro}
                onChange={(e) => set({ skipIfPresent: e.target.checked })}
              />
              <p className="cfg-muted">Na Allegro gratis sprzedaje się jako składnik zestawu. Bez tej opcji kupujący zestawu z łyżeczką dostałby drugą.</p>
            </div>
            <FormField label="Limit na klienta (po pilocie, opcjonalnie)" name="promo-limit" description="Ile razy jeden klient może dostać gratis z tej promocji. Liczony po kliencie rozpoznanym przez OpenLinkera, nie po e-mailu.">
              <Input type="number" min={0} value={p.perCustomerLimit ?? ''} placeholder="bez limitu" disabled={ro} onChange={(e) => set({ perCustomerLimit: e.target.value ? Number(e.target.value) : null })} />
            </FormField>
            {p.perCustomerLimit !== null && allegroIn ? (
              <Alert tone={scenario === 'per-customer-limit' ? 'warning' : 'info'} density="compact" title="Na Allegro i Erli e-mail to alias">
                Allegro podaje inny adres e-mail w każdej transakcji, więc limit po e-mailu nic by nie dał. OpenLinker liczy po kliencie, którego już rozpoznaje: na Allegro po identyfikatorze kupującego, w sklepach po e-mailu, telefonie i NIP.
              </Alert>
            ) : null}
          </div>
        </DetailSection>

        <DetailSection title="Gratis">
          <div className="cfg-stack">
            <div className="cfg-fields cfg-fields--2">
              <FormField label="Produkt" name="promo-gift">
                <Select value={p.gift} disabled={ro} onChange={(e) => set({ gift: e.target.value })}>
                  {Object.entries(VARIANTS).map(([k, vv]) => (
                    <option key={k} value={k}>
                      {vv.name} ({Math.max(0, vv.stock - vv.held)} szt.)
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Ilość" name="promo-qty">
                <Input type="number" min={1} value={p.giftQty} disabled={ro} onChange={(e) => set({ giftQty: Math.max(1, Number(e.target.value) || 1) })} />
              </FormField>
            </div>
            <SegmentedControl className="cfg-seg"
              aria-label="Ile gratisów"
              options={[
                { value: 'fixed', label: 'Stała ilość na zamówienie', disabled: ro },
                { value: 'per-unit', label: 'Za każde N sztuk z warunku', disabled: ro },
              ]}
              value={p.perUnit ? 'per-unit' : 'fixed'}
              onChange={(val) => set({ perUnit: val === 'per-unit' })}
            />
            {p.perUnit ? (
              <div className="cfg-fields cfg-fields--2">
                <FormField label="Co ile sztuk" name="promo-per-n" description="1 = gratis do każdej sztuki, 2 = jeden gratis na 2 sztuki.">
                  <Input type="number" min={1} value={p.perN} disabled={ro} onChange={(e) => set({ perN: Math.max(1, Number(e.target.value) || 1) })} />
                </FormField>
                <FormField label="Maks. na zamówienie" name="promo-max-order" description="Opcjonalnie. Puste = bez limitu.">
                  <Input type="number" min={1} value={p.maxPerOrder ?? ''} placeholder="bez limitu" disabled={ro} onChange={(e) => set({ maxPerOrder: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
                </FormField>
              </div>
            ) : null}
            <span className="cfg-row">
              <GiftMark source="ol-rule" />
              <span className="cfg-muted tabular">dostępne {avail} szt.</span>
              {avail === 0 ? <StatusBadge tone="error" compact>Brak na stanie</StatusBadge> : avail <= 2 ? <StatusBadge tone="warning" compact>Mało na stanie</StatusBadge> : null}
            </span>
            <WhoPaysStrip qty={p.giftQty} unitCost={unitCost} currency={currency} fx={EUR_RATE} />
            {unitCost !== null && unitCost > SMALL_GIFT_UNIT_LIMIT ? (
              <p className="cfg-muted">Koszt sztuki przekracza 20 zł netto. Taki gratis nie mieści się w drobnych prezentach, zapytaj doradcę podatkowego.</p>
            ) : unitCost !== null ? (
              <p className="cfg-muted">OpenLinker zapisuje każdy gratis w raporcie: komu, kiedy, koszt zakupu i stawka. To dane dla księgowości, nie porada podatkowa.</p>
            ) : null}
            <div>
              <p className="cfg-muted">Droga gratisu ({oms ? 'OMS włączony' : 'OMS wyłączony'})</p>
              <StockPathTrail
                steps={
                  oms
                    ? [
                        { label: 'Dodano pozycję gratisu', state: 'done', detail: 'przy przyjęciu zamówienia' },
                        { label: 'Zarezerwowano', state: 'done' },
                        { label: 'Spakowano', state: 'active', detail: 'pakowacz skanuje gratis' },
                        { label: 'Zdjęto ze stanu w PrestaShop', state: 'todo', detail: 'powód: gratis' },
                      ]
                    : [
                        { label: 'Dodano pozycję gratisu', state: 'done' },
                        { label: 'Wysłano do PrestaShop jako pozycja 0,00 zł', state: 'active' },
                        { label: 'Sklep zdjął stan', state: 'todo' },
                      ]
                }
              />
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Łączenie z innymi promocjami">
          <div className="cfg-stack cfg-stack--tight">
            <Switch checked={!p.stackable} disabled={ro} hint={roReason} onChange={(val) => set({ stackable: !val })} label="Nie łącz z innymi promocjami" />
            <p className="cfg-muted">
              {place <= PROMOTIONS.length ? `Ta promocja jest na miejscu ${place} z ${PROMOTIONS.length} na liście.` : 'Nowa promocja trafi na koniec listy.'} OpenLinker sprawdza promocje od góry. Kolejność zmieniasz na liście promocji.
            </p>
          </div>
        </DetailSection>

        <DetailSection title="Limit sztuk">
          <div className="cfg-stack">
            <FormField label="Ile gratisów wydać w całej promocji" name="promo-cap" description="Puste = do wyczerpania stanu gratisu.">
              <Input type="number" min={1} value={p.unitCap ?? ''} placeholder="bez limitu" disabled={ro} onChange={(e) => set({ unitCap: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
            </FormField>
            <CapBar given={p.given} cap={p.unitCap} />
            <p className="cfg-secondary tabular">
              Koszt całego limitu: {p.unitCap === null ? 'zależy od stanu gratisu' : estimate === null ? 'nieznany, brak kosztu zakupu' : `${money(estimate, 'PLN')} (${p.unitCap} x ${money(unitCost, 'PLN')})`}
            </p>
            <p className="cfg-muted">Gdy limit się wyczerpie albo gratisu zabraknie na stanie, promocja wstrzyma się sama i pokaże powód na liście.</p>
          </div>
        </DetailSection>

        <DetailSection title="Gdy gratisu zabraknie">
          <FilterChecks role="radiogroup" aria-label="Gdy gratisu zabraknie">
            {(
              [
                ['skip-and-flag', 'Wstrzymaj promocję, zamówienia idą bez gratisu z uwagą'],
                ['hold-order', 'Wstrzymaj zamówienie do dostawy gratisu'],
                ['substitute', 'Wydaj zamiennik'],
              ] as [StockPolicy, string][]
            ).map(([val, label]) => (
              <FilterCheck key={val} type="radio" name="promo-policy" label={label} checked={p.policy === val} disabled={ro} onChange={() => set({ policy: val })} />
            ))}
          </FilterChecks>
          {p.policy === 'substitute' ? (
            <FormField label="Zamiennik" name="promo-substitute">
              <Select value={p.substitute ?? 'bag'} disabled={ro} onChange={(e) => set({ substitute: e.target.value })}>
                {Object.entries(VARIANTS).filter(([k]) => k !== p.gift).map(([k, vv]) => (
                  <option key={k} value={k}>
                    {vv.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          <p className="cfg-muted">Zamówienie nigdy nie przechodzi po cichu: każdy brak gratisu widać na zamówieniu i w historii reguły.</p>
        </DetailSection>

        <WhereMatrix selected={p.channels} />
        <DryRun edited={p} initial={scenario === 'dry-run-two-match' ? 'o1' : scenario === 'per-customer-limit' ? 'o3' : scenario === 'skip-if-present' ? 'o4' : null} />
      </div>
    </PageLayout>
  );
}

function PromotionsScreen({ scenario }: { scenario: Scenario }): ReactElement {
  return scenario === 'list' ? <PromotionList /> : <Composer scenario={scenario} />;
}

export const screen: ScreenDef = {
  id: 'promotions',
  group: 'Katalog',
  label: 'Promocje z gratisem',
  states: [
    { id: 'list', label: 'Lista promocji', note: 'Wszystkie reguły z gratisem w kolejności sprawdzania: stan, gratis, kanały, okres, limit sztuk i koszt. Kolejność zmieniasz przyciskami Wyżej i Niżej. Decyzja: bez numerów priorytetu. Kolejność na liście plus jeden przełącznik "Nie łącz z innymi", jak w PrestaShop i BOGOS (Shopify); BaseLinker, Apilo i Sellasist stosują wszystkie pasujące reguły po kolei.', useCases: ['G-06', 'G-12'], priority: 'pilot' },
    { id: 'composer-draft', label: 'Nowa reguła (szkic)', note: 'Kompozytor reguły: wyzwalacz "Zamówienie przyjęte", warunki, gratis, łączenie, limit sztuk, co gdy gratisu zabraknie, gdzie to działa i test na zamówieniu. Szkic nie działa na zamówieniach. Decyzja: liczy się tylko data złożenia zamówienia i reguła nie działa wstecz, jak w Apilo, Sellasist i Cin7.', useCases: ['G-06', 'G-04'], priority: 'pilot', channels: ['prestashop'] },
    { id: 'active', label: 'Aktywna', note: 'Łyżeczka do każdego zestawu porannego na Allegro i Erli, najwyżej 2 na zamówienie. Te kanały nie znają gratisów: klient nie widzi gratisu na zamówieniu, ale OpenLinker dodaje pozycję, rezerwuje ją i zdejmuje ze stanu z powodem "gratis". Decyzja: "1 gratis na N sztuk" z opcjonalnym limitem na zamówienie, jak Shopify (BOGOS) i Mirakl.', useCases: ['G-06', 'G-04'], priority: 'pilot', channels: ['allegro', 'erli'] },
    { id: 'paused', label: 'Wstrzymana', note: 'Wstrzymana reguła nie dodaje gratisu do nowych zamówień. Zamówienia z już dodanym gratisem go zachowują.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'limit-reached', label: 'Limit sztuk wyczerpany', note: 'Promocja wydała wszystkie 50 toreb z limitu i wstrzymała się sama. Wznowienie wymaga wyższego limitu. Decyzja: limit w sztukach i stop przy braku stanu, jak BaseLinker, Apilo i Sellasist. Nikt na rynku nie liczy budżetu gratisów w złotówkach.', useCases: ['G-06', 'G-08'], priority: 'pilot', channels: ['prestashop', 'woocommerce'] },
    { id: 'ended', label: 'Zakończona', note: 'Okres minął. Promocję nadal można edytować, np. przedłużyć daty i wznowić, albo skopiować na kolejny okres. Zamówienia z gratisem trzymają własną kopię promocji. Decyzja: bez blokady tylko do odczytu; reguły są edytowalne z przyciskiem kopiowania w Linnworks, Apilo i Sellasist.', useCases: ['G-12'], priority: 'later' },
    { id: 'edited-open-orders', label: 'Edycja przy otwartych zamówieniach', note: 'Reguła ma wersje. 3 otwarte zamówienia dostały gratis według v1 i go zachowują. Zmiana działa na zamówienia przyjęte po zapisie.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'gift-out-of-stock', label: 'Gratis bez stanu', note: 'Próbki kawy nie ma na stanie, więc promocja wstrzymała się sama. Zamówienia idą dalej bez gratisu i dostają uwagę. Wznowi się sama po dostawie. Decyzja: brak gratisu na stanie zatrzymuje promocję, jak w Sellasist i BaseLinker; zamiennik zostaje jako opcja.', useCases: ['G-08', 'G-16'], priority: 'pilot' },
    { id: 'gift-no-cost', label: 'Gratis bez kosztu zakupu', note: 'Młynek z Subiekta nie ma kosztu zakupu. Promocję można aktywować, a koszt w analityce jest nieznany, dopóki ktoś go nie uzupełni. Decyzja: koszt zakupu nie jest warunkiem aktywacji, bo nie ma już budżetu w złotówkach.', useCases: ['G-12', 'G-06'], priority: 'pilot' },
    { id: 'dry-run-two-match', label: 'Test: pasują 2 reguły', note: 'Testowe zamówienie z Allegro pasuje do łyżeczki (miejsce 1) i próbki (miejsce 2). Próbka nie łączy się z innymi, a łyżeczka jest wyżej, więc stosowana jest tylko łyżeczka. Decyzja: pierwsza pasująca na liście wygrywa, gdy nie łączy się z innymi.', useCases: ['G-06'], priority: 'pilot', channels: ['allegro'] },
    { id: 'skip-if-present', label: 'Test: produkt już w zamówieniu', note: 'Zestaw poranny v2 ma łyżeczkę w składzie. Promocja ma zaznaczone "Pomiń, jeśli produkt jest już w zamówieniu", więc nie dodaje drugiej. Decyzja: jedna ogólna opcja zamiast osobnej reguły dla zestawów, jak "Exclude added product" w BOGOS i warunek "Contains SKU" w Brightpearl. Na Allegro gratis sprzedaje się jako składnik zestawu, więc tam to ważne.', useCases: ['G-06'], priority: 'pilot', channels: ['allegro'] },
    { id: 'per-customer-limit', label: 'Limit na klienta', note: 'Limit 1 na klienta, opcjonalny i do zrobienia po pilocie. Na Allegro e-mail to alias zmieniany w każdej transakcji, więc OpenLinker liczy po rozpoznanym kliencie. Test pokazuje zamówienie klienta, który już dostał gratis. Decyzja: klucz to rozpoznany klient OpenLinkera (BaseLinker łączy po telefonie i loginie Allegro); sam limit może poczekać.', useCases: ['G-15'], priority: 'later', channels: ['allegro'] },
    ...commonStates('promocji', 'utwórz pierwszą promocję z gratisem'),
  ],
  render: (state) => <PromotionsScreen key={state} scenario={state as Scenario} />,
};
