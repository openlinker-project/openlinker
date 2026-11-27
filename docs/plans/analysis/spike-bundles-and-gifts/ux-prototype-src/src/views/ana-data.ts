/**
 * Analytics mock data and pure figures for the "Koszt gratisów i zestawy" screen.
 * Every money figure is derived from the catalogue model (VARIANTS cost, PROMOTIONS
 * given/spent, BUNDLES price/components) so the tables always add up. Grosze.
 */
import { BUNDLES, CHANNELS, PROMOTIONS, VARIANTS, type BundleComponent, type ChannelId, type MasterId } from '../model/catalog';
import { bundleCost, giftCost, splitBundlePrice, vatOfGross, SMALL_GIFT_UNIT_LIMIT, SMALL_GIFT_YEAR_LIMIT } from '../model/calc';

/* ── Period and weekly buckets ─────────────────────────────────────── */

export const PERIOD = { from: '2026-10-01', to: '2026-11-04' };
export const WEEKS = ['2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'];

/** Gifts given per week, per promotion. Each row sums to PROMOTIONS[i].given. */
const WEEKLY_GIVEN: Record<string, number[]> = {
  'promo-oct': [14, 18, 17, 19, 12, 0],
  'promo-bag': [12, 11, 10, 9, 8, 0],
  'promo-sample': [0, 0, 0, 0, 52, 68],
  'promo-spoon': [0, 0, 0, 0, 14, 26],
  'promo-xmas': [0, 0, 0, 0, 0, 0],
};

/** Gifts given per channel, per promotion (sums to given). */
const CHANNEL_GIVEN: Record<string, Partial<Record<ChannelId, number>>> = {
  'promo-spoon': { allegro: 31, erli: 9 },
  'promo-sample': { allegro: 46, prestashop: 38, woocommerce: 17, shoper: 11, erli: 8 },
  'promo-bag': { prestashop: 34, woocommerce: 16 },
  'promo-oct': { allegro: 80 },
  'promo-xmas': {},
};

/** Orders that received the gift, per channel. Equal to given except a per-unit gift. */
const CHANNEL_ORDERS: Record<string, Partial<Record<ChannelId, number>>> = {
  'promo-spoon': { allegro: 26, erli: 8 },
  'promo-sample': CHANNEL_GIVEN['promo-sample'],
  'promo-bag': CHANNEL_GIVEN['promo-bag'],
  'promo-oct': CHANNEL_GIVEN['promo-oct'],
  'promo-xmas': {},
};

/** Orders that received gifts from two promotions at once (counted once in the headline). */
export const OVERLAP_ORDERS = 16;

/** Gross margin (before gift cost) of the orders that carried a gift, per channel. */
const MARGIN_BEFORE_GIFTS: Partial<Record<ChannelId, number>> = {
  allegro: 1018400, prestashop: 452300, woocommerce: 198700, shoper: 87900, erli: 141200,
};

/** Samples given in the week of 27 Oct, ingested before the sample cost was recorded. */
export const SAMPLE_NO_COST_UNITS = 52;
/** Discretionary apology gifts added by an operator, from the Subiekt master (no cost). */
export const OPERATOR_GIFTS = { variant: 'grinder', qty: 2, channel: 'allegro' as ChannelId, orders: 2 };

export interface GiftRow {
  id: string;
  name: string;
  source: 'promotion' | 'operator';
  status: string;
  gift: string;
  given: number;
  orders: number;
  /** Known cost; null when nothing is known. */
  cost: number | null;
  /** Units given whose cost is unknown. */
  unknownUnits: number;
  budget: number | null;
  spent: number;
  channels: Partial<Record<ChannelId, number>>;
  weekly: number[];
}

export interface GiftFigures {
  rows: GiftRow[];
  given: number;
  ordersSum: number;
  ordersUnique: number;
  knownCost: number;
  unknownUnits: number;
  marginBefore: number;
  weeklyCost: number[];
  perChannel: { id: ChannelId; given: number; orders: number; cost: number; unknownUnits: number; marginBefore: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic', active: 'Aktywna', paused: 'Wstrzymana', 'budget-reached': 'Budżet wyczerpany', ended: 'Zakończona',
};
export const promoStatusLabel = (s: string): string => STATUS_LABEL[s] ?? s;

/** All gift figures for the period. `withGaps` adds the cost-unknown cases. */
export function giftFigures(withGaps: boolean): GiftFigures {
  const rows: GiftRow[] = PROMOTIONS.map((p) => {
    const units = p.given * p.giftQty;
    const unknown = withGaps && p.id === 'promo-sample' ? SAMPLE_NO_COST_UNITS : 0;
    const full = giftCost(p.gift, units) ?? 0;
    const cost = full - (giftCost(p.gift, unknown) ?? 0);
    const orders = Object.values(CHANNEL_ORDERS[p.id] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    return {
      id: p.id, name: p.name, source: 'promotion', status: p.status, gift: p.gift, given: units, orders, cost,
      unknownUnits: unknown, budget: p.budget, spent: p.spent, channels: CHANNEL_GIVEN[p.id] ?? {}, weekly: WEEKLY_GIVEN[p.id] ?? [],
    };
  });
  if (withGaps) {
    rows.push({
      id: 'operator', name: 'Dodane ręcznie przez operatora (przeprosiny)', source: 'operator', status: 'manual', gift: OPERATOR_GIFTS.variant,
      given: OPERATOR_GIFTS.qty, orders: OPERATOR_GIFTS.orders, cost: null, unknownUnits: OPERATOR_GIFTS.qty, budget: null, spent: 0,
      channels: { [OPERATOR_GIFTS.channel]: OPERATOR_GIFTS.qty }, weekly: [0, 0, 0, 1, 1, 0],
    });
  }
  const weeklyCost = WEEKS.map((_, w) =>
    rows.reduce((acc, r) => {
      const c = VARIANTS[r.gift].cost;
      if (c === null) return acc;
      let n = r.weekly[w] ?? 0;
      if (withGaps && r.id === 'promo-sample' && w === 4) n -= SAMPLE_NO_COST_UNITS;
      return acc + Math.max(0, n) * c;
    }, 0),
  );
  const channelIds = Object.keys(CHANNELS) as ChannelId[];
  const perChannel = channelIds
    .map((id) => {
      let given = 0;
      let orders = 0;
      let cost = 0;
      let unknownUnits = 0;
      for (const r of rows) {
        const g = r.channels[id] ?? 0;
        if (!g) continue;
        given += g;
        orders += r.source === 'operator' ? g : (CHANNEL_ORDERS[r.id]?.[id] ?? 0);
        const c = VARIANTS[r.gift].cost;
        // The cost-unknown samples all came from Allegro and PrestaShop in proportion; keep it simple: Allegro first.
        let unknownHere = 0;
        if (r.unknownUnits > 0) {
          if (r.source === 'operator') unknownHere = g;
          else if (id === 'allegro') unknownHere = Math.min(g, r.unknownUnits);
          else if (id === 'prestashop') unknownHere = Math.min(g, Math.max(0, r.unknownUnits - (r.channels.allegro ?? 0)));
        }
        unknownUnits += unknownHere;
        if (c !== null) cost += (g - unknownHere) * c;
      }
      return { id, given, orders, cost, unknownUnits, marginBefore: MARGIN_BEFORE_GIFTS[id] ?? 0 };
    })
    .filter((c) => c.given > 0);
  const given = rows.reduce((a, r) => a + r.given, 0);
  const ordersSum = rows.reduce((a, r) => a + r.orders, 0);
  return {
    rows,
    given,
    ordersSum,
    ordersUnique: ordersSum - OVERLAP_ORDERS,
    knownCost: rows.reduce((a, r) => a + (r.cost ?? 0), 0),
    unknownUnits: rows.reduce((a, r) => a + r.unknownUnits, 0),
    marginBefore: Object.values(MARGIN_BEFORE_GIFTS).reduce((a, b) => a + (b ?? 0), 0),
    weeklyCost,
    perChannel,
  };
}

/* ── Small-gift register (PL country pack) ─────────────────────────── */

export interface Recipient {
  key: string;
  hash: string;
  name: string;
  channel: ChannelId;
  gifts: { variant: string; qty: number; treatment: 'internal-record' | 'priced-in' }[];
}

export const RECIPIENTS: Recipient[] = [
  { key: 'ol_cust_1c07', hash: '9c2e41a7', name: 'Kawa-Bar sp. z o.o.', channel: 'prestashop', gifts: [{ variant: 'press', qty: 2, treatment: 'internal-record' }, { variant: 'spoon', qty: 8, treatment: 'internal-record' }, { variant: 'sample', qty: 1, treatment: 'internal-record' }] },
  { key: 'ol_cust_3b9e', hash: '51fd08c3', name: 'Marek Wiśniewski', channel: 'woocommerce', gifts: [{ variant: 'press', qty: 1, treatment: 'internal-record' }, { variant: 'sample', qty: 1, treatment: 'internal-record' }, { variant: 'tea', qty: 1, treatment: 'internal-record' }] },
  { key: 'ol_cust_8f21', hash: 'e07b9d12', name: 'Anna Kowalska', channel: 'allegro', gifts: [{ variant: 'spoon', qty: 2, treatment: 'internal-record' }, { variant: 'sample', qty: 1, treatment: 'internal-record' }] },
  { key: 'ol_cust_77d4', hash: '3fa96c50', name: 'Aleksandra Nowak', channel: 'erli', gifts: [{ variant: 'grinder', qty: 1, treatment: 'internal-record' }, { variant: 'sample', qty: 1, treatment: 'internal-record' }] },
  { key: 'ol_cust_a3f9', hash: 'b81c2e99', name: 'Piotr Zieliński', channel: 'shoper', gifts: [{ variant: 'bag', qty: 1, treatment: 'internal-record' }, { variant: 'sample', qty: 1, treatment: 'internal-record' }, { variant: 'mug', qty: 1, treatment: 'priced-in' }] },
];

export interface RecipientTotals {
  count: number;
  /** Year-to-date net purchase cost of gratuitous gifts; null when any is unknown. */
  total: number | null;
  known: number;
  pricedIn: number;
  status: 'ok' | 'over' | 'unknown';
}

export function recipientTotals(r: Recipient): RecipientTotals {
  let known = 0;
  let unknown = false;
  let count = 0;
  let pricedIn = 0;
  for (const g of r.gifts) {
    if (g.treatment === 'priced-in') {
      pricedIn += g.qty;
      continue;
    }
    count += g.qty;
    const c = giftCost(g.variant, g.qty);
    if (c === null) unknown = true;
    else known += c;
  }
  const status = unknown ? 'unknown' : known > SMALL_GIFT_YEAR_LIMIT ? 'over' : 'ok';
  return { count, total: unknown ? null : known, known, pricedIn, status };
}

/** Per gift variant: is the unit purchase cost under the 20 zł no-register limit? */
export function unitLimitRows(): { variant: string; cost: number | null; ok: boolean | null }[] {
  const used = new Set<string>();
  for (const r of RECIPIENTS) for (const g of r.gifts) if (g.treatment === 'internal-record') used.add(g.variant);
  return [...used].map((v) => {
    const cost = VARIANTS[v].cost;
    return { variant: v, cost, ok: cost === null ? null : cost <= SMALL_GIFT_UNIT_LIMIT };
  });
}

/* ── Bundles ───────────────────────────────────────────────────────── */

export interface BundleSale {
  id: string;
  name: string;
  sku: string;
  version: number | null;
  price: number;
  components: BundleComponent[];
  units: number;
  orders: Partial<Record<ChannelId, number>>;
  /** Master that owns the bundle variant. */
  master: MasterId;
  extra?: boolean;
}

/** A bundle defined over a component with no recorded purchase cost. Only in the no-cost scenario. */
export const GRINDER_SET: BundleSale = {
  id: 'ol_variant_set_grinder', name: 'Zestaw młynek i kawa', sku: 'ZES-MLYNEK', version: 1, price: 15900,
  components: [{ variant: 'grinder', qty: 1 }, { variant: 'coffee', qty: 1 }], units: 6, orders: { allegro: 4, prestashop: 2 }, master: 'subiekt', extra: true,
};

export function bundleSales(withNoCost: boolean): BundleSale[] {
  const m = BUNDLES.morning;
  const list: BundleSale[] = [
    { id: `${m.id}:v1`, name: m.name, sku: m.sku, version: 1, price: m.price, components: m.versions[0].components, units: 62, orders: { allegro: 34, prestashop: 18, erli: 6 }, master: 'prestashop' },
    { id: `${m.id}:v2`, name: m.name, sku: m.sku, version: 2, price: m.price, components: m.versions[1].components, units: 38, orders: { allegro: 22, prestashop: 10, erli: 4 }, master: 'prestashop' },
    { id: BUNDLES.brew.id, name: BUNDLES.brew.name, sku: BUNDLES.brew.sku, version: 1, price: BUNDLES.brew.price, components: BUNDLES.brew.versions[0].components, units: 41, orders: { allegro: 14, prestashop: 12, woocommerce: 9, shoper: 5 }, master: 'prestashop' },
    { id: BUNDLES.triple.id, name: BUNDLES.triple.name, sku: BUNDLES.triple.sku, version: 1, price: BUNDLES.triple.price, components: BUNDLES.triple.versions[0].components, units: 27, orders: { allegro: 27 }, master: 'prestashop' },
  ];
  if (withNoCost) list.push(GRINDER_SET);
  return list;
}

/** Net (VAT-exclusive) revenue of one set: split the gross price by component rate. */
export function setNet(price: number, components: BundleComponent[]): number {
  return splitBundlePrice(price, components).reduce((a, s) => a + (s.share - vatOfGross(s.share, s.vat)), 0);
}

export interface BundleFigures {
  sale: BundleSale;
  gross: number;
  net: number;
  unitCost: number | null;
  cost: number | null;
  margin: number | null;
  giftSlotCost: number;
  orders: number;
}

export function bundleFigures(s: BundleSale): BundleFigures {
  const unitCost = bundleCost(s.components);
  const net = setNet(s.price, s.components) * s.units;
  const cost = unitCost === null ? null : unitCost * s.units;
  const giftSlotCost = s.components.filter((c) => c.gift).reduce((a, c) => a + (VARIANTS[c.variant].cost ?? 0) * c.qty, 0);
  return {
    sale: s, gross: s.price * s.units, net, unitCost, cost, margin: cost === null ? null : net - cost, giftSlotCost,
    orders: Object.values(s.orders).reduce((a, b) => a + (b ?? 0), 0),
  };
}

/** All orders in the period, per channel (attach-rate denominator). */
export const ALL_ORDERS: Partial<Record<ChannelId, number>> = { allegro: 612, prestashop: 318, woocommerce: 154, shoper: 96, erli: 60 };
/** Orders that carried two different bundles (counted once in the headline). */
export const BUNDLE_OVERLAP_ORDERS = 3;

/** Units sold on their own (not inside a bundle) in the period. */
export const SOLD_ALONE: Record<string, number> = { mug: 140, coffee: 318, spoon: 21, press: 12, grinder: 3 };

export function componentDemand(sales: BundleSale[]): { variant: string; viaBundles: number; asGiftSlot: number; alone: number; available: number }[] {
  const via = new Map<string, { n: number; gift: number }>();
  for (const s of sales) {
    for (const c of s.components) {
      const cur = via.get(c.variant) ?? { n: 0, gift: 0 };
      cur.n += c.qty * s.units;
      if (c.gift) cur.gift += c.qty * s.units;
      via.set(c.variant, cur);
    }
  }
  return [...via.entries()]
    .map(([variant, v]) => ({ variant, viaBundles: v.n, asGiftSlot: v.gift, alone: SOLD_ALONE[variant] ?? 0, available: Math.max(0, VARIANTS[variant].stock - VARIANTS[variant].held) }))
    .sort((a, b) => b.viaBundles - a.viaBundles);
}

/** Week weights of bundle sales for the trend chart (sum 1). */
export const BUNDLE_WEEK_WEIGHTS = [0.14, 0.16, 0.17, 0.18, 0.2, 0.15];

/* ── Stock movement ledger ─────────────────────────────────────────── */

export type MovementType = 'sale' | 'gift' | 'bundle-component' | 'manual' | 'return' | 'sync';

export interface Movement {
  id: string;
  at: string;
  variant: string;
  /** Display name when the row is not a catalogue variant (a PrestaShop pack). */
  label?: string;
  type: MovementType;
  delta: number;
  before: number;
  after: number | null;
  status: 'applied' | 'refused';
  /** Reason detail shown under the type chip. */
  reason?: string;
  order?: { ref: string; channel: ChannelId; lineId: string };
  returnRef?: string;
  actor?: string;
  master: MasterId;
  /** A gift slot inside a bundle: listed under both filters. */
  giftSlot?: boolean;
  refusal?: string;
}

export const MOVEMENTS: Movement[] = [
  { id: 'm12', at: '2026-11-04T10:42:00Z', variant: 'spoon', type: 'gift', delta: -1, before: 5, after: 4, status: 'applied', reason: 'Gratis (promocja Łyżeczka gratis do zestawu porannego)', order: { ref: 'AL-58210', channel: 'allegro', lineId: 'ol-gift:promo-spoon:58210-1' }, master: 'prestashop' },
  { id: 'm11', at: '2026-11-04T10:42:00Z', variant: 'mug', type: 'bundle-component', delta: -1, before: 85, after: 84, status: 'applied', reason: 'Składnik zestawu (Zestaw poranny v1)', order: { ref: 'AL-58210', channel: 'allegro', lineId: '58210-1~c:ol_variant_mug' }, master: 'prestashop' },
  { id: 'm10', at: '2026-11-04T10:42:00Z', variant: 'coffee', type: 'bundle-component', delta: -1, before: 141, after: 140, status: 'applied', reason: 'Składnik zestawu (Zestaw poranny v1)', order: { ref: 'AL-58210', channel: 'allegro', lineId: '58210-1~c:ol_variant_coffee' }, master: 'prestashop' },
  { id: 'm09', at: '2026-11-04T09:15:00Z', variant: 'press', type: 'bundle-component', delta: -1, before: 24, after: 23, status: 'applied', reason: 'Składnik zestawu (Zestaw do parzenia v1)', order: { ref: 'PS-10233', channel: 'prestashop', lineId: '10233-1~c:ol_variant_press' }, master: 'prestashop' },
  { id: 'm08', at: '2026-11-04T09:15:00Z', variant: 'coffee', type: 'bundle-component', delta: -2, before: 143, after: 141, status: 'applied', reason: 'Składnik zestawu (Zestaw do parzenia v1)', order: { ref: 'PS-10233', channel: 'prestashop', lineId: '10233-1~c:ol_variant_coffee' }, master: 'prestashop' },
  { id: 'm07', at: '2026-11-03T16:20:00Z', variant: 'mug', label: 'Zestaw poranny (pakiet PrestaShop)', type: 'bundle-component', delta: -1, before: 7, after: null, status: 'refused', reason: 'Składnik zestawu (pakiet PrestaShop)', order: { ref: 'PS-10229', channel: 'prestashop', lineId: '10229-1' }, master: 'prestashop', refusal: 'Pakiet PrestaShop w trybie składników: sklep nie pozwala zdjąć stanu pakietu. Zdejmij stan składników ręcznie albo zdefiniuj zestaw w OpenLinker.' },
  { id: 'm06', at: '2026-11-03T15:02:00Z', variant: 'sample', type: 'gift', delta: -1, before: 1, after: 0, status: 'applied', reason: 'Gratis (promocja Próbka kawy przy zakupach od 150 zł)', order: { ref: 'WC-3391', channel: 'woocommerce', lineId: 'ol-gift:promo-sample:3391-2' }, master: 'prestashop' },
  { id: 'm05', at: '2026-11-03T14:10:00Z', variant: 'spoon', type: 'bundle-component', giftSlot: true, delta: -1, before: 6, after: 5, status: 'applied', reason: 'Gratis w zestawie (Zestaw poranny v2)', order: { ref: 'ER-77120', channel: 'erli', lineId: '77120-1~c:ol_variant_spoon' }, master: 'prestashop' },
  { id: 'm04', at: '2026-11-03T14:10:00Z', variant: 'mug', type: 'bundle-component', delta: -1, before: 86, after: 85, status: 'applied', reason: 'Składnik zestawu (Zestaw poranny v2)', order: { ref: 'ER-77120', channel: 'erli', lineId: '77120-1~c:ol_variant_mug' }, master: 'prestashop' },
  { id: 'm03', at: '2026-11-03T11:30:00Z', variant: 'spoon', type: 'manual', delta: -1, before: 7, after: 6, status: 'applied', reason: 'Gratis z notatki dla pakowacza, zamówienie AL-58177 (tryb pilota)', actor: 'Joanna Lis', master: 'prestashop' },
  { id: 'm02', at: '2026-11-02T18:05:00Z', variant: 'mug', type: 'return', delta: 1, before: 85, after: 86, status: 'applied', reason: 'Przyjęcie na stan po zwrocie', returnRef: 'ZW-0091', order: { ref: 'PS-10188', channel: 'prestashop', lineId: '10188-1' }, master: 'prestashop' },
  { id: 'm01', at: '2026-11-02T12:00:00Z', variant: 'mug', type: 'sale', delta: -1, before: 86, after: 85, status: 'applied', reason: 'Sprzedaż', order: { ref: 'PS-10201', channel: 'prestashop', lineId: '10201-1' }, master: 'prestashop' },
  { id: 'm00', at: '2026-11-02T09:00:00Z', variant: 'grinder', type: 'sale', delta: -1, before: 10, after: 9, status: 'applied', reason: 'Sprzedaż', order: { ref: 'AL-58102', channel: 'allegro', lineId: '58102-1' }, master: 'subiekt' },
];
