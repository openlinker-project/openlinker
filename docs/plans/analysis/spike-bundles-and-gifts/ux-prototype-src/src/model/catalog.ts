/**
 * Prototype catalogue: one coffee shop selling on seven channels. Every amount is
 * in minor units (grosze) so the arithmetic in calc.ts is exact.
 */

export type ChannelId = 'allegro' | 'prestashop' | 'woocommerce' | 'shoper' | 'erli' | 'idosell' | 'empik';
export type MasterId = 'prestashop' | 'subiekt';
export type VatRate = 23 | 8 | 5 | 0;

export interface Variant {
  id: string;
  sku: string;
  ean: string;
  name: string;
  /** Gross standalone selling price in grosze. */
  price: number;
  vat: VatRate;
  /** Net purchase cost in grosze; null = not recorded. */
  cost: number | null;
  /** Physical stock per owning master. */
  stock: number;
  /** OL holds already promised to other orders. */
  held: number;
  master: MasterId;
  producer: string;
  image: string;
  archived?: boolean;
  stale?: boolean;
}

const svg = (fill: string, glyph: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${fill}"/><text x="32" y="41" font-size="28" text-anchor="middle" font-family="sans-serif" fill="#fff">${glyph}</text></svg>`,
  )}`;

export const VARIANTS: Record<string, Variant> = {
  mug: { id: 'ol_variant_mug', sku: 'KUB-350-BI', ean: '5901234123457', name: 'Kubek ceramiczny 350 ml, biały', price: 3999, vat: 23, cost: 1420, stock: 84, held: 6, master: 'prestashop', producer: 'Ceramika Bolesławiec', image: svg('#8a6f5a', 'K') },
  coffee: { id: 'ol_variant_coffee', sku: 'KAW-250-ETI', ean: '5907654321098', name: 'Kawa ziarnista Etiopia 250 g', price: 3499, vat: 5, cost: 1850, stock: 140, held: 12, master: 'prestashop', producer: 'Palarnia Kawowy Świat', image: svg('#5b3a29', 'Ka') },
  tea: { id: 'ol_variant_tea', sku: 'HER-100-CZ', ean: '5906543210987', name: 'Herbata czarna Assam 100 g', price: 1999, vat: 5, cost: 810, stock: 62, held: 2, master: 'prestashop', producer: 'Herbaciarnia Liść', image: svg('#7a5d2e', 'H') },
  book: { id: 'ol_variant_book', sku: 'KSI-PARZ', ean: '9788301234567', name: 'Książka "Parzenie kawy w domu"', price: 4900, vat: 5, cost: 2200, stock: 18, held: 1, master: 'prestashop', producer: 'Wydawnictwo Ziarno', image: svg('#3f5b78', 'Ks') },
  press: { id: 'ol_variant_press', sku: 'ZAP-FP-800', ean: '5905551112223', name: 'Zaparzacz French press 800 ml', price: 8900, vat: 23, cost: 4100, stock: 23, held: 3, master: 'prestashop', producer: 'Bodum', image: svg('#2f4f4f', 'Z') },
  spoon: { id: 'ol_variant_spoon', sku: 'LYZ-KAW', ean: '5904443332221', name: 'Łyżeczka do kawy, stal', price: 1499, vat: 23, cost: 390, stock: 4, held: 3, master: 'prestashop', producer: 'Gerlach', image: svg('#7a7f86', 'Ł') },
  bag: { id: 'ol_variant_bag', sku: 'TOR-PREZ', ean: '5903332221110', name: 'Torba prezentowa kraft', price: 999, vat: 23, cost: 240, stock: 310, held: 0, master: 'prestashop', producer: 'Eko Pak', image: svg('#a0763d', 'T') },
  sample: { id: 'ol_variant_sample', sku: 'KAW-50-PROB', ean: '5902221110009', name: 'Próbka kawy Kolumbia 50 g', price: 999, vat: 5, cost: 310, stock: 0, held: 0, master: 'prestashop', producer: 'Palarnia Kawowy Świat', image: svg('#6b4423', 'P') },
  grinder: { id: 'ol_variant_grinder', sku: 'MLY-RECZ', ean: '5901112223334', name: 'Młynek ręczny, żarna ceramiczne', price: 12900, vat: 23, cost: null, stock: 9, held: 0, master: 'subiekt', producer: 'Hario', image: svg('#4a4a4a', 'M') },
};

export interface BundleComponent {
  variant: keyof typeof VARIANTS;
  qty: number;
  /** A gift slot inside the bundle (D3d). */
  gift?: boolean;
}

export interface BundleVersion {
  version: number;
  savedAt: string;
  components: BundleComponent[];
}

export interface Bundle {
  id: string;
  sku: string;
  name: string;
  /** Gross bundle price in grosze. */
  price: number;
  versions: BundleVersion[];
  channels: ChannelId[];
  image: string;
}

export const BUNDLES: Record<string, Bundle> = {
  morning: {
    id: 'ol_variant_set_morning', sku: 'ZES-PORANNY', name: 'Zestaw poranny', price: 6499,
    versions: [
      { version: 1, savedAt: '2026-10-02', components: [{ variant: 'mug', qty: 1 }, { variant: 'coffee', qty: 1 }] },
      { version: 2, savedAt: '2026-11-02', components: [{ variant: 'mug', qty: 1 }, { variant: 'coffee', qty: 1 }, { variant: 'spoon', qty: 1, gift: true }] },
    ],
    channels: ['allegro', 'prestashop', 'erli'], image: svg('#c06b2c', 'ZP'),
  },
  brew: {
    id: 'ol_variant_set_brew', sku: 'ZES-PARZENIE', name: 'Zestaw do parzenia', price: 13900,
    versions: [{ version: 1, savedAt: '2026-09-14', components: [{ variant: 'press', qty: 1 }, { variant: 'coffee', qty: 2 }] }],
    channels: ['allegro', 'prestashop', 'woocommerce', 'shoper'], image: svg('#2f5d50', 'ZD'),
  },
  triple: {
    id: 'ol_variant_set_triple', sku: 'KAW-3PAK', name: 'Kawa Etiopia, 3 opakowania', price: 9499,
    versions: [{ version: 1, savedAt: '2026-10-20', components: [{ variant: 'coffee', qty: 3 }] }],
    channels: ['allegro'], image: svg('#5b3a29', '3x'),
  },
};

export interface Channel {
  id: ChannelId;
  name: string;
  kind: 'marketplace' | 'shop';
  /** How the channel can express a free gift on the order. */
  giftSupport: 'native-flag' | 'cart-rule' | 'plugin' | 'app-price' | 'none';
  /** How the channel sends a bundle. */
  bundleShape: 'parent-only' | 'parent-and-children' | 'children-grouped' | 'sku-only';
  emitsChildrenAsLines: boolean | null;
  colorVar: string;
}

export const CHANNELS: Record<ChannelId, Channel> = {
  allegro: { id: 'allegro', name: 'Allegro', kind: 'marketplace', giftSupport: 'none', bundleShape: 'parent-only', emitsChildrenAsLines: false, colorVar: '--channel-allegro' },
  prestashop: { id: 'prestashop', name: 'PrestaShop', kind: 'shop', giftSupport: 'cart-rule', bundleShape: 'parent-only', emitsChildrenAsLines: false, colorVar: '--channel-prestashop' },
  woocommerce: { id: 'woocommerce', name: 'WooCommerce', kind: 'shop', giftSupport: 'plugin', bundleShape: 'parent-and-children', emitsChildrenAsLines: true, colorVar: '--channel-woocommerce' },
  shoper: { id: 'shoper', name: 'Shoper', kind: 'shop', giftSupport: 'app-price', bundleShape: 'parent-and-children', emitsChildrenAsLines: null, colorVar: '--tag-teal' },
  erli: { id: 'erli', name: 'Erli', kind: 'marketplace', giftSupport: 'none', bundleShape: 'sku-only', emitsChildrenAsLines: false, colorVar: '--channel-erli' },
  idosell: { id: 'idosell', name: 'IdoSell', kind: 'shop', giftSupport: 'native-flag', bundleShape: 'children-grouped', emitsChildrenAsLines: true, colorVar: '--tag-blue' },
  empik: { id: 'empik', name: 'Empik', kind: 'marketplace', giftSupport: 'native-flag', bundleShape: 'sku-only', emitsChildrenAsLines: false, colorVar: '--tag-pink' },
};

export const MASTERS: Record<MasterId, { id: MasterId; name: string }> = {
  prestashop: { id: 'prestashop', name: 'PrestaShop (kawowyswiat.pl)' },
  subiekt: { id: 'subiekt', name: 'Subiekt GT' },
};

export type GiftSource = 'channel-flag' | 'cart-rule' | 'inferred' | 'ol-rule' | 'operator';
export type StockPolicy = 'skip-and-flag' | 'hold-order' | 'substitute';

export interface Promotion {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'budget-reached' | 'ended';
  gift: keyof typeof VARIANTS;
  giftQty: number;
  perUnit: boolean;
  channels: ChannelId[];
  minBasket: number | null;
  containsSku: string | null;
  from: string;
  to: string;
  dateBasis: 'placed-at' | 'received-at';
  perCustomerLimit: number | null;
  priority: number;
  stackable: boolean;
  budget: number | null;
  spent: number;
  policy: StockPolicy;
  substitute?: keyof typeof VARIANTS;
  version: number;
  openOrdersOnOldVersion: number;
  given: number;
}

export const PROMOTIONS: Promotion[] = [
  { id: 'promo-spoon', name: 'Łyżeczka gratis do zestawu porannego', status: 'active', gift: 'spoon', giftQty: 1, perUnit: true, channels: ['allegro', 'erli'], minBasket: null, containsSku: 'ZES-PORANNY', from: '2026-11-01', to: '2026-11-30', dateBasis: 'placed-at', perCustomerLimit: null, priority: 1, stackable: true, budget: 60000, spent: 15600, policy: 'substitute', substitute: 'bag', version: 2, openOrdersOnOldVersion: 3, given: 40 },
  { id: 'promo-sample', name: 'Próbka kawy przy zakupach od 150 zł', status: 'active', gift: 'sample', giftQty: 1, perUnit: false, channels: ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'], minBasket: 15000, containsSku: null, from: '2026-11-01', to: '2026-12-24', dateBasis: 'placed-at', perCustomerLimit: 1, priority: 2, stackable: false, budget: null, spent: 37200, policy: 'skip-and-flag', version: 1, openOrdersOnOldVersion: 0, given: 120 },
  { id: 'promo-bag', name: 'Torba prezentowa przy 2 kubkach', status: 'budget-reached', gift: 'bag', giftQty: 1, perUnit: false, channels: ['prestashop', 'woocommerce'], minBasket: null, containsSku: 'KUB-350-BI', from: '2026-10-01', to: '2026-12-31', dateBasis: 'placed-at', perCustomerLimit: null, priority: 3, stackable: true, budget: 12000, spent: 12000, policy: 'skip-and-flag', version: 1, openOrdersOnOldVersion: 0, given: 50 },
  { id: 'promo-xmas', name: 'Świąteczna herbata gratis', status: 'draft', gift: 'tea', giftQty: 1, perUnit: false, channels: ['prestashop'], minBasket: 20000, containsSku: null, from: '2026-12-01', to: '2026-12-24', dateBasis: 'placed-at', perCustomerLimit: 1, priority: 4, stackable: false, budget: 80000, spent: 0, policy: 'hold-order', version: 1, openOrdersOnOldVersion: 0, given: 0 },
  { id: 'promo-oct', name: 'Październikowa łyżeczka', status: 'ended', gift: 'spoon', giftQty: 1, perUnit: false, channels: ['allegro'], minBasket: 10000, containsSku: null, from: '2026-10-01', to: '2026-10-31', dateBasis: 'placed-at', perCustomerLimit: null, priority: 5, stackable: true, budget: null, spent: 31200, policy: 'skip-and-flag', version: 1, openOrdersOnOldVersion: 0, given: 80 },
];

export type GiftDocTreatment = 'omit' | 'hold' | 'grosz' | 'priced-in' | 'internal-record';
export type BundleDocTreatment = 'one-line' | 'components';
export type DocProvider = 'eparagony' | 'ksef' | 'infakt' | 'subiekt';

export const DOC_PROVIDERS: Record<DocProvider, { name: string; zeroLine: boolean; zeroRateBucket: boolean; lineRebate: boolean; p10: boolean }> = {
  eparagony: { name: 'eparagony.pl (paragon)', zeroLine: true, zeroRateBucket: false, lineRebate: true, p10: false },
  ksef: { name: 'KSeF (faktura)', zeroLine: true, zeroRateBucket: true, lineRebate: false, p10: true },
  infakt: { name: 'inFakt (faktura)', zeroLine: true, zeroRateBucket: true, lineRebate: false, p10: false },
  subiekt: { name: 'Subiekt GT (paragon i faktura)', zeroLine: false, zeroRateBucket: false, lineRebate: true, p10: false },
};
