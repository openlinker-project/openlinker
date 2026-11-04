/**
 * Shared data and pure helpers for the catalogue and settings screens
 * (bundles, bundle editor, promotions, connection settings). Prefix: cfg.
 */
import { BUNDLES, CHANNELS, VARIANTS, type Bundle, type BundleComponent, type ChannelId, type Promotion, type VatRate } from '../model/catalog';
import { vatOfGross } from '../model/calc';

export type VariantKey = keyof typeof VARIANTS;

/** A fourth bundle that only exists on this screen: a Subiekt GT komplet. */
export const SUBIEKT_KIT: Bundle = {
  id: 'ol_variant_set_grind',
  sku: 'KPL-MLYNEK',
  name: 'Zestaw z młynkiem',
  price: 19900,
  versions: [{ version: 1, savedAt: '2026-10-28', components: [{ variant: 'grinder', qty: 1 }, { variant: 'mug', qty: 1 }, { variant: 'coffee', qty: 1 }] }],
  channels: ['allegro', 'erli'],
  image: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#4a4a4a"/><text x="32" y="41" font-size="26" text-anchor="middle" font-family="sans-serif" fill="#fff">ZM</text></svg>'),
};

export const ALL_BUNDLES: { key: string; bundle: Bundle; master: 'prestashop' | 'subiekt' }[] = [
  { key: 'morning', bundle: BUNDLES.morning, master: 'prestashop' },
  { key: 'brew', bundle: BUNDLES.brew, master: 'prestashop' },
  { key: 'triple', bundle: BUNDLES.triple, master: 'prestashop' },
  { key: 'grind', bundle: SUBIEKT_KIT, master: 'subiekt' },
];

export const channelName = (id: ChannelId): string => CHANNELS[id].name;

/** Short Polish name for a variant (cut at the first comma). */
export function shortName(key: string): string {
  const v = VARIANTS[key];
  return v ? v.name.split(',')[0] : key;
}

export interface ShareLine {
  variant: string;
  qty: number;
  /** Standalone price x qty, null when the price is missing. */
  standalone: number | null;
  share: number;
  vat: VatRate;
  gift: boolean;
}

/**
 * The same proportional split as model/calc splitBundlePrice, with a price
 * lookup the caller can change (a price change in the master, a missing price).
 * Returns null shares when a paid component has no standalone price.
 */
export function splitWithPrices(price: number, components: BundleComponent[], priceOf: (key: string) => number | null): { lines: ShareLine[]; missing: string[] } {
  const missing = components.filter((c) => !c.gift && priceOf(c.variant) === null).map((c) => c.variant);
  const paid = components.filter((c) => !c.gift);
  const weights = paid.map((c) => (priceOf(c.variant) ?? 0) * c.qty);
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total && !missing.length ? (price * w) / total : 0));
  const floors = raw.map(Math.floor);
  let rest = missing.length || !total ? 0 : price - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i] += 1;
    rest -= 1;
  }
  let k = 0;
  const lines = components.map((c) => {
    const p = priceOf(c.variant);
    const share = c.gift ? 0 : floors[k++];
    return { variant: c.variant, qty: c.qty, standalone: p === null ? null : p * c.qty, share, vat: VARIANTS[c.variant].vat, gift: c.gift === true };
  });
  return { lines, missing };
}

/** Net value of a bundle sold at `price`, using each component's own rate for its share. */
export function bundleNet(price: number, components: BundleComponent[]): number {
  const { lines } = splitWithPrices(price, components, (k) => VARIANTS[k].price);
  return lines.reduce((a, l) => a + (l.share - vatOfGross(l.share, l.vat)), 0);
}

export function marginPct(net: number, cost: number | null): number | null {
  if (cost === null || net <= 0) return null;
  return Math.round(((net - cost) / net) * 1000) / 10;
}

export function pct(n: number | null): string {
  return n === null ? '-' : `${n.toFixed(1).replace('.', ',')}%`;
}

/** Bundles a component is used in, newest version only, plus older versions still held by orders. */
export function usedIn(variant: string): { key: string; bundle: Bundle; qty: number; gift: boolean; version: number }[] {
  const out: { key: string; bundle: Bundle; qty: number; gift: boolean; version: number }[] = [];
  for (const { key, bundle } of ALL_BUNDLES) {
    const v = bundle.versions[bundle.versions.length - 1];
    const c = v.components.find((x) => x.variant === variant);
    if (c) out.push({ key, bundle, qty: c.qty, gift: c.gift === true, version: v.version });
  }
  return out;
}

/* ── Promotions ─────────────────────────────────────────────────────── */

/** A draft whose gift has no purchase cost recorded (the grinder from Subiekt). */
export const NO_COST_PROMO: Promotion = {
  id: 'promo-grinder', name: 'Młynek gratis przy zamówieniu od 600 zł', status: 'draft', gift: 'grinder', giftQty: 1, perUnit: false,
  channels: ['prestashop', 'woocommerce'], minBasket: 60000, containsSku: null, from: '2026-12-01', to: '2026-12-31',
  perCustomerLimit: null, perN: 1, maxPerOrder: null, skipIfPresent: false, stackable: false, unitCap: 20, spent: 0, policy: 'skip-and-flag', version: 1, openOrdersOnOldVersion: 0, given: 0,
};

export const STATUS_LABEL: Record<Promotion['status'], string> = {
  draft: 'Szkic',
  active: 'Aktywna',
  paused: 'Wstrzymana',
  'limit-reached': 'Wstrzymana: limit sztuk',
  'out-of-stock': 'Wstrzymana: brak gratisu',
  ended: 'Zakończona',
};

export const STATUS_TONE: Record<Promotion['status'], 'neutral' | 'success' | 'warning' | 'info' | 'error'> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
  'limit-reached': 'warning',
  'out-of-stock': 'warning',
  ended: 'neutral',
};

export interface GiftWhere {
  kind: 'native' | 'shop-rule' | 'ol-only' | 'plugin';
  label: string;
  tone: 'success' | 'info' | 'neutral' | 'warning';
  buyerSees: string;
  warehouse: string;
}

/** "Where this works" for one channel, from CHANNELS.giftSupport. */
export function giftWhere(id: ChannelId): GiftWhere {
  const s = CHANNELS[id].giftSupport;
  switch (s) {
    case 'native-flag':
      return { kind: 'native', label: 'Natywnie w kanale', tone: 'success', buyerSees: 'Kanał oznacza gratis w zamówieniu, klient widzi go na zamówieniu.', warehouse: 'OpenLinker czyta znacznik kanału i traktuje pozycję jako gratis.' };
    case 'cart-rule':
      return { kind: 'shop-rule', label: 'Sklep ma regułę koszyka', tone: 'info', buyerSees: 'Reguła koszyka sklepu dodaje gratis w pełnej cenie i zeruje go rabatem.', warehouse: 'Ustal, kto dodaje gratis: zostaw to OpenLinkerowi albo dopasuj regułę koszyka, żeby nie dać dwóch.' };
    case 'plugin':
    case 'app-price':
      return { kind: 'plugin', label: s === 'plugin' ? 'Wtyczka sklepu' : 'Aplikacja sklepu', tone: 'warning', buyerSees: 'Gratis przychodzi jako pozycja za 0,01 zł bez znacznika.', warehouse: 'OpenLinker rozpozna go po cenie tylko z Twoją regułą rozpoznawania.' };
    default:
      return { kind: 'ol-only', label: 'Tylko w OpenLinkerze', tone: 'neutral', buyerSees: 'Klient nie widzi gratisu na zamówieniu w kanale.', warehouse: 'OpenLinker dodaje pozycję gratisu do zamówienia, rezerwuje ją, pakowacz ją skanuje, stan schodzi z powodem "gratis".' };
  }
}

export const ALL_CHANNELS: ChannelId[] = ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli', 'idosell', 'empik'];

export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};
