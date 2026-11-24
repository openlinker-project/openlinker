/**
 * Promocje z gratisem (catalogue): the list of OpenLinker gift rules and a
 * composer for one rule (trigger, conditions, gift, priority, budget,
 * out-of-stock policy, "where this works" per channel, dry run).
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
  | 'budget-reached'
  | 'ended'
  | 'edited-open-orders'
  | 'gift-out-of-stock'
  | 'gift-no-cost'
  | 'dry-run-two-match'
  | 'per-customer-limit';

const byId = (id: string): Promotion => PROMOTIONS.find((p) => p.id === id) ?? PROMOTIONS[0];

function promoFor(s: Scenario): Promotion {
  switch (s) {
    case 'composer-draft':
      return byId('promo-xmas');
    case 'active':
    case 'edited-open-orders':
    case 'dry-run-two-match':
      return byId('promo-spoon');
    case 'paused':
      return { ...byId('promo-spoon'), status: 'paused' };
    case 'budget-reached':
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
  'promo-bag': 'budget-reached',
  'promo-xmas': 'composer-draft',
  'promo-oct': 'ended',
};

const giftAvail = (k: string): number => Math.max(0, VARIANTS[k].stock - VARIANTS[k].held);

function BudgetBar({ spent, budget }: { spent: number; budget: number | null }): ReactElement {
  const money = useMoney();
  if (budget === null) return <span className="cfg-muted">bez limitu, wydano {money(spent, 'PLN')}</span>;
  const ratio = Math.min(1, budget ? spent / budget : 0);
  return (
    <span className="cfg-bar">
      <span className="cfg-bar__track" aria-hidden="true">
        <span className={`cfg-bar__fill${ratio >= 1 ? ' cfg-bar__fill--full' : ''}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      <span className="cfg-bar__label tabular">
        {money(spent, 'PLN')} z {money(budget, 'PLN')}
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
  const { canWrite, reason } = useWriteGuard();
  const columns: DataTableColumn<Promotion>[] = [
    {
      id: 'name',
      header: 'Promocja',
      cell: (p) => (
        <span className="cfg-cell-stack cfg-cell-stack--start">
          <button type="button" className="cfg-link cfg-strong" onClick={() => go('promotions', STATE_OF[p.id] ?? 'active')}>
            {p.name}
          </button>
          <span className="cfg-muted tabular">
            priorytet {p.priority}
            {p.stackable ? ', łączy się' : ', nie łączy się'} · v{p.version}
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
            {p.perUnit ? ' na każdą sztukę' : ''}
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
    { id: 'budget', header: 'Budżet', cell: (p) => <BudgetBar spent={p.spent} budget={p.budget} /> },
    { id: 'given', header: 'Wydano', align: 'right', hideBelow: 768, cell: (p) => <span className="tabular">{p.given} szt.</span> },
    { id: 'cost', header: 'Koszt dotąd', align: 'right', hideBelow: 1024, cell: (p) => <span className="tabular">{money(p.spent, 'PLN')}</span> },
  ];
  const active = PROMOTIONS.filter((p) => p.status === 'active').length;
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
        <Alert tone="warning" density="compact" title="Próbka kawy nie ma stanu" action={<Button tone="secondary" onClick={() => go('promotions', 'gift-out-of-stock')}>Zobacz promocję</Button>}>
          Promocja "Próbka kawy przy zakupach od 150 zł" pomija gratis i zgłasza uwagę na zamówieniu.
        </Alert>
        <DataTable
          caption="Promocje z gratisem"
          rows={PROMOTIONS}
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
                <BudgetBar spent={p.spent} budget={p.budget} />
                <span className="cfg-muted tabular">wydano {p.given} szt.</span>
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
  customerNote: string;
}

const SAMPLE_ORDERS: SampleOrder[] = [
  { id: 'o1', label: 'Allegro ALG-7821: Zestaw poranny + 3 x kawa Etiopia, 179,96 zł', channel: 'allegro', total: 17996, skus: ['ZES-PORANNY', 'KAW-250-ETI'], qtyBySku: { 'ZES-PORANNY': 1, 'KAW-250-ETI': 3 }, priorGifts: [], customerNote: 'Kupujący Allegro 48213, pierwsze zamówienie' },
  { id: 'o2', label: 'PrestaShop 1042: 2 x kubek, 79,98 zł', channel: 'prestashop', total: 7998, skus: ['KUB-350-BI'], qtyBySku: { 'KUB-350-BI': 2 }, priorGifts: [], customerNote: 'anna.kowalska@example.pl, tel. 600 100 200' },
  { id: 'o3', label: 'Allegro ALG-7830: 5 x kawa Etiopia, 174,95 zł', channel: 'allegro', total: 17495, skus: ['KAW-250-ETI'], qtyBySku: { 'KAW-250-ETI': 5 }, priorGifts: ['promo-sample'], customerNote: 'Kupujący Allegro 48213, gratis z tej promocji 12 paź' },
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
    if (p.status === 'budget-reached' || (p.budget !== null && p.spent >= p.budget)) return { promo: p, matched: true, outcome: 'Pominięta: budżet', tone: 'warning', why: 'Pasuje, ale budżet jest wyczerpany. Promocja wstrzymała się sama.' };
    if (p.perCustomerLimit !== null && order.priorGifts.includes(p.id)) return { promo: p, matched: true, outcome: 'Pominięta: limit klienta', tone: 'warning', why: 'Ten klient dostał już gratis z tej promocji.' };
    return { promo: p, matched: true, outcome: 'Pasuje', tone: 'success', why: isEdited && p.status !== 'active' ? 'Test traktuje tę regułę jak aktywną.' : 'Wszystkie warunki spełnione.' };
  });
  const eligible = cands.filter((c) => c.outcome === 'Pasuje').sort((a, b) => a.promo.priority - b.promo.priority);
  const applied: Promotion[] = [];
  for (const c of eligible) {
    const ok = applied.length === 0 || (c.promo.stackable && applied.every((a) => a.stackable));
    if (ok) {
      applied.push(c.promo);
      const avail = giftAvail(c.promo.gift);
      const need = c.promo.giftQty * (c.promo.perUnit && c.promo.containsSku ? order.qtyBySku[c.promo.containsSku] ?? 1 : 1);
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
      c.outcome = 'Pominięta: priorytet';
      c.tone = 'neutral';
      c.why = `${!c.promo.stackable ? 'Ta promocja nie łączy się z innymi' : `"${top.name}" nie łączy się z innymi`}, więc wygrywa priorytet ${top.priority}.`;
    }
  }
  return cands.sort((a, b) => Number(b.matched) - Number(a.matched) || a.promo.priority - b.promo.priority);
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
              {matched > 1 ? 'Gdy pasuje kilka reguł, wygrywa najniższy numer priorytetu. Dalsze reguły dochodzą tylko wtedy, gdy wszystkie łączą się z innymi.' : 'Wynik pokazuje, co OpenLinker zrobiłby z tym zamówieniem przy przyjęciu.'}
            </Alert>
            <div className="cfg-scroll">
              <table className="cfg-table">
                <caption className="sr-only">Wynik testu reguł</caption>
                <thead>
                  <tr>
                    <th scope="col">Reguła</th>
                    <th scope="col" className="cfg-right">Priorytet</th>
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
                      <td className="cfg-right tabular">{r.promo.priority}</td>
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
    case 'budget-reached':
      return (
        <Alert tone="warning" title="Budżet wyczerpany, promocja wstrzymała się sama">
          Wydano {money(promo.spent, 'PLN')} z {money(promo.budget, 'PLN')} (koszt zakupu gratisów). Od 28 paź nowe zamówienia nie dostają torby. Zwiększ budżet, żeby wznowić.
        </Alert>
      );
    case 'ended':
      return (
        <Alert tone="info" title="Promocja zakończona 31 paź">
          Wydano {promo.given} gratisów za {money(promo.spent, 'PLN')}. Możesz ją powielić na kolejny okres. Historia zostaje w raporcie gratisów.
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
        <Alert tone="warning" title="Próbka kawy: 0 szt. na stanie" action={<Button tone="secondary" onClick={() => go('orders')}>Zobacz zamówienia</Button>}>
          Zgodnie z ustawieniem "Pomiń i zgłoś" 14 zamówień od 2 lis poszło dalej bez gratisu i ma uwagę "Gratis bez stanu". Dodaj zamiennik albo uzupełnij stan.
        </Alert>
      );
    case 'gift-no-cost':
      return (
        <Alert tone="warning" title="Młynek ręczny nie ma kosztu zakupu">
          Bez kosztu nie policzymy budżetu ani kosztu promocji. Uzupełnij koszt zakupu wariantu w katalogu albo usuń budżet.
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
  const [uses, setUses] = useState('200');
  const set = (patch: Partial<Promotion>): void => setP((x) => ({ ...x, ...patch }));
  const ro = !canWrite || base.status === 'ended';
  const roReason = !canWrite ? reason : base.status === 'ended' ? 'Zakończonej promocji nie zmienisz. Powiel ją.' : undefined;

  const v = VARIANTS[p.gift];
  const unitCost = v.cost;
  const usesN = Math.max(0, Number(uses) || 0);
  const estimate = unitCost === null ? null : unitCost * p.giftQty * usesN;
  const overBudget = p.budget !== null && estimate !== null && p.spent + estimate > p.budget;
  const avail = giftAvail(p.gift);
  const allegroIn = p.channels.includes('allegro') || p.channels.includes('erli');
  const toast = (title: string, description: string) => showToast({ title, description, tone: 'success' });
  const activationBlocked = unitCost === null && p.budget !== null;

  let actions: ReactNode;
  if (base.status === 'draft')
    actions = (
      <>
        <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Zapisano szkic', `${p.name}: szkic zapisany.`)}>
          Zapisz szkic
        </Button>
        <Button disabled={!canWrite || activationBlocked} title={!canWrite ? reason : activationBlocked ? 'Uzupełnij koszt gratisu albo usuń budżet.' : undefined} onClick={() => toast('Aktywowano promocję', `${p.name} działa od ${formatDate(p.from)}.`)}>
          Aktywuj promocję
        </Button>
      </>
    );
  else if (base.status === 'active')
    actions = (
      <>
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
  else if (base.status === 'budget-reached') {
    const raised = p.budget !== null && p.budget > p.spent;
    actions = (
      <Button disabled={!canWrite || !raised} title={!canWrite ? reason : !raised ? 'Zwiększ budżet powyżej wydanej kwoty.' : undefined} onClick={() => toast('Wznowiono promocję', `Budżet ${money(p.budget, 'PLN')}, promocja znowu działa.`)}>
        Zwiększ budżet i wznów
      </Button>
    );
  } else
    actions = (
      <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => toast('Powielono promocję', 'Nowy szkic na kolejny okres.')}>
        Powiel promocję
      </Button>
    );

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
            <FormField label="Która data się liczy" name="promo-date-basis" description="Zamówienie złożone 30 lis wieczorem może trafić do OpenLinkera 1 gru. Wybierz, która data decyduje.">
              <SegmentedControl className="cfg-seg"
                aria-label="Która data się liczy"
                options={[
                  { value: 'placed-at', label: 'Data złożenia', disabled: ro },
                  { value: 'received-at', label: 'Data przyjęcia', disabled: ro },
                ]}
                value={p.dateBasis}
                onChange={(val) => set({ dateBasis: val as Promotion['dateBasis'] })}
              />
            </FormField>
            <FormField label="Limit na klienta" name="promo-limit" description="Ile razy jeden klient może dostać gratis z tej promocji.">
              <Input type="number" min={0} value={p.perCustomerLimit ?? ''} placeholder="bez limitu" disabled={ro} onChange={(e) => set({ perCustomerLimit: e.target.value ? Number(e.target.value) : null })} />
            </FormField>
            {p.perCustomerLimit !== null && allegroIn ? (
              <Alert tone={scenario === 'per-customer-limit' ? 'warning' : 'info'} density="compact" title="Na Allegro i Erli e-mail to alias">
                Allegro podaje inny adres e-mail w każdej transakcji, więc limit po e-mailu nic by nie dał. OpenLinker liczy tam limit po identyfikatorze kupującego w kanale, a w sklepach po e-mailu, telefonie i NIP.
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
                { value: 'per-unit', label: 'Na każdą sztukę z warunku', disabled: ro },
              ]}
              value={p.perUnit ? 'per-unit' : 'fixed'}
              onChange={(val) => set({ perUnit: val === 'per-unit' })}
            />
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

        <DetailSection title="Priorytet i łączenie">
          <div className="cfg-fields cfg-fields--2">
            <FormField label="Priorytet" name="promo-priority" description="1 wygrywa z 2, gdy pasuje kilka reguł.">
              <Input type="number" min={1} value={p.priority} disabled={ro} onChange={(e) => set({ priority: Math.max(1, Number(e.target.value) || 1) })} />
            </FormField>
            <FormField label="Łączenie" name="promo-stack" description="Czy ten gratis może dojść do innego gratisu w tym samym zamówieniu.">
              <Switch checked={p.stackable} disabled={ro} hint={roReason} onChange={(val) => set({ stackable: val })} label={p.stackable ? 'Łączy się z innymi' : 'Nie łączy się z innymi'} />
            </FormField>
          </div>
        </DetailSection>

        <DetailSection title="Budżet">
          <div className="cfg-stack">
            <div className="cfg-fields cfg-fields--2">
              <FormField label="Budżet (koszt zakupu, zł)" name="promo-budget">
                <Input inputMode="decimal" value={p.budget === null ? '' : String(p.budget / 100)} placeholder="bez limitu" disabled={!canWrite} onChange={(e) => set({ budget: e.target.value ? Math.round(Number(e.target.value.replace(',', '.')) * 100) : null })} />
              </FormField>
              <FormField label="Spodziewane użycia" name="promo-uses">
                <Input type="number" min={0} value={uses} disabled={ro} onChange={(e) => setUses(e.target.value)} />
              </FormField>
            </div>
            <BudgetBar spent={p.spent} budget={p.budget} />
            <p className="cfg-secondary tabular">
              Szacowany koszt: {estimate === null ? 'nieznany, brak kosztu zakupu' : `${money(estimate, 'PLN')} (${usesN} x ${p.giftQty} x ${money(unitCost, 'PLN')})`}
            </p>
            {overBudget ? (
              <Alert tone="warning" density="compact" title="Szacunek przekracza budżet">
                Gdy budżet się skończy, promocja wstrzyma się sama, a zamówienia pójdą bez gratisu.
              </Alert>
            ) : null}
          </div>
        </DetailSection>

        <DetailSection title="Gdy gratisu zabraknie">
          <FilterChecks role="radiogroup" aria-label="Gdy gratisu zabraknie">
            {(
              [
                ['skip-and-flag', 'Pomiń gratis i zgłoś uwagę na zamówieniu'],
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
        <DryRun edited={p} initial={scenario === 'dry-run-two-match' ? 'o1' : scenario === 'per-customer-limit' ? 'o3' : null} />
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
    { id: 'list', label: 'Lista promocji', note: 'Wszystkie reguły z gratisem: stan, gratis, kanały, okres, zużycie budżetu i koszt. Kliknij nazwę, żeby otworzyć regułę.', useCases: ['G-06', 'G-12'], priority: 'pilot' },
    { id: 'composer-draft', label: 'Nowa reguła (szkic)', note: 'Kompozytor reguły: wyzwalacz "Zamówienie przyjęte", warunki, gratis, priorytet, budżet, polityka braku, gdzie to działa i test na zamówieniu. Szkic nie działa na zamówieniach.', useCases: ['G-06', 'G-04'], priority: 'pilot', channels: ['prestashop'] },
    { id: 'active', label: 'Aktywna', note: 'Łyżeczka do każdego zestawu porannego na Allegro i Erli. Te kanały nie znają gratisów: klient nie widzi gratisu na zamówieniu, ale OpenLinker dodaje pozycję, rezerwuje ją i zdejmuje ze stanu z powodem "gratis".', useCases: ['G-06', 'G-04'], priority: 'pilot', channels: ['allegro', 'erli'] },
    { id: 'paused', label: 'Wstrzymana', note: 'Wstrzymana reguła nie dodaje gratisu do nowych zamówień. Zamówienia z już dodanym gratisem go zachowują.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'budget-reached', label: 'Budżet wyczerpany', note: 'Budżet liczony z kosztu zakupu gratisów się skończył i reguła wstrzymała się sama. Wznowienie wymaga większego budżetu.', useCases: ['G-06', 'G-08'], priority: 'pilot', channels: ['prestashop', 'woocommerce'] },
    { id: 'ended', label: 'Zakończona', note: 'Okres minął. Reguły nie da się edytować, można ją powielić. Historia gratisów zostaje w raporcie.', useCases: ['G-12'], priority: 'later' },
    { id: 'edited-open-orders', label: 'Edycja przy otwartych zamówieniach', note: 'Reguła ma wersje. 3 otwarte zamówienia dostały gratis według v1 i go zachowują. Zmiana działa na zamówienia przyjęte po zapisie.', useCases: ['G-06'], priority: 'pilot' },
    { id: 'gift-out-of-stock', label: 'Gratis bez stanu', note: 'Próbki kawy nie ma na stanie. Polityka "Pomiń i zgłoś": zamówienie idzie dalej bez gratisu i dostaje uwagę. Nic nie dzieje się po cichu.', useCases: ['G-08', 'G-16'], priority: 'pilot' },
    { id: 'gift-no-cost', label: 'Gratis bez kosztu zakupu', note: 'Młynek z Subiekta nie ma kosztu zakupu. Budżet i szacowany koszt są nieznane, więc aktywacja z budżetem jest zablokowana.', useCases: ['G-12', 'G-06'], priority: 'pilot' },
    { id: 'dry-run-two-match', label: 'Test: pasują 2 reguły', note: 'Testowe zamówienie z Allegro pasuje do łyżeczki (priorytet 1) i próbki (priorytet 2). Próbka nie łączy się z innymi, więc stosowana jest tylko łyżeczka.', useCases: ['G-06'], priority: 'pilot', channels: ['allegro'] },
    { id: 'per-customer-limit', label: 'Limit na klienta', note: 'Limit 1 na klienta. Na Allegro e-mail to alias zmieniany w każdej transakcji, więc OpenLinker liczy po identyfikatorze kupującego. Test pokazuje zamówienie klienta, który już dostał gratis.', useCases: ['G-15'], priority: 'later', channels: ['allegro'] },
    ...commonStates('promocji', 'utwórz pierwszą promocję z gratisem'),
  ],
  render: (state) => <PromotionsScreen key={state} scenario={state as Scenario} />,
};
