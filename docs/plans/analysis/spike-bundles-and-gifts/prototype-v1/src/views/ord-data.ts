/**
 * Mock orders for the orders list, order detail and pack bench views.
 * Amounts are grosze (PLN) unless the scenario says EUR, where the view converts.
 */
import type { StatusBadgeTone } from '@web/shared/ui/status-badge';
import { BUNDLES, VARIANTS, type ChannelId, type GiftSource } from '../model/catalog';
import { splitBundlePrice } from '../model/calc';
import type { TrailStep } from '../ui/marks';

export type OrdLineKind = 'goods' | 'bundle' | 'component' | 'gift' | 'service' | 'ignored';
export type OrdStage = 'new' | 'reserved' | 'packing' | 'packed' | 'shipped' | 'cancelled';
export type Funder = 'seller' | 'channel' | 'unknown';

export interface OrdBadge {
  label: string;
  tone: StatusBadgeTone;
}

export interface OrdLine {
  id: string;
  kind: OrdLineKind;
  /** VARIANTS key when the line is a catalogue variant. */
  variant?: string;
  name?: string;
  sku?: string;
  image?: string;
  qty: number;
  /** What the buyer pays per unit, grosze. */
  unitPrice: number;
  /** Standalone catalogue price per unit, grosze. */
  listPrice?: number;
  giftSource?: GiftSource;
  /** Bundle name, for component rows. */
  partOf?: string;
  /** Component share of the bundle price (all units), grosze. */
  share?: number;
  /** Frozen bundle version, for bundle rows. */
  version?: number;
  vatLabel?: string;
  note?: string;
  status?: OrdBadge;
  /** Overrides the computed stock path. */
  trail?: TrailStep[];
  /** Line taken off the order (shown struck). */
  removed?: boolean;
  /** Exists only in OpenLinker; the channel does not see it. */
  olOnly?: boolean;
  funder?: Funder;
}

export interface OrdAdjustment {
  label: string;
  /** Negative for a reduction, grosze. */
  amount: number;
  funder: Funder | 'none';
  note?: string;
}

export interface OrdEvent {
  at: string;
  title: string;
  by?: string;
  desc?: string;
  tone?: 'default' | 'success' | 'error' | 'warning' | 'conflict';
}

export interface OrdScenario {
  id: string;
  number: string;
  channel: ChannelId;
  placedAt: string;
  buyer: string;
  city: string;
  currency?: 'EUR';
  health: OrdBadge;
  phase: OrdBadge;
  payment: string;
  stage: OrdStage;
  lines: OrdLine[];
  adjustments: OrdAdjustment[];
  shipping: number;
  delivery: string;
  timeline: OrdEvent[];
  payload?: { title: string; lines: { text: string; tone?: 'warn' | 'muted' | 'key' }[] };
  /** Show "what OpenLinker sends back to the channel". */
  writeback?: boolean;
  /** Forces the OMS reading regardless of the global switch. */
  forceOms?: boolean;
}

export const v = (key: string) => VARIANTS[key];

/* ── Line builders ─────────────────────────────────────────────────── */

export function goods(id: string, variant: string, qty: number, unitPrice?: number, extra: Partial<OrdLine> = {}): OrdLine {
  const x = v(variant);
  return { id, kind: 'goods', variant, qty, unitPrice: unitPrice ?? x.price, listPrice: x.price, ...extra };
}

export function gift(id: string, variant: string, qty: number, source: GiftSource, extra: Partial<OrdLine> = {}): OrdLine {
  const x = v(variant);
  return { id, kind: 'gift', variant, qty, unitPrice: 0, listPrice: x.price, giftSource: source, funder: 'seller', ...extra };
}

/** Bundle row plus its component rows, frozen at the given version. */
export function bundle(id: string, key: string, version: number, qty: number, extra: Partial<OrdLine> = {}, compExtra: Partial<OrdLine> = {}): OrdLine[] {
  const b = BUNDLES[key];
  const ver = b.versions.find((x) => x.version === version) ?? b.versions[0];
  const split = splitBundlePrice(b.price, ver.components);
  const list = ver.components.filter((c) => !c.gift).reduce((a, c) => a + v(c.variant).price * c.qty, 0);
  const parent: OrdLine = { id, kind: 'bundle', name: b.name, sku: b.sku, image: b.image, qty, unitPrice: b.price, listPrice: list, version: ver.version, ...extra };
  const comps: OrdLine[] = ver.components.map((c, i) => {
    const x = v(c.variant);
    return c.gift
      ? { id: `${id}~g:${c.variant}`, kind: 'gift', variant: c.variant, qty: c.qty * qty, unitPrice: 0, listPrice: x.price, partOf: b.name, funder: 'seller', share: 0, ...compExtra }
      : { id: `${id}~c:${c.variant}`, kind: 'component', variant: c.variant, qty: c.qty * qty, unitPrice: 0, listPrice: x.price, partOf: b.name, share: split[i].share * qty, ...compExtra };
  });
  return [parent, ...comps];
}

export function lineName(l: OrdLine): string {
  return l.name ?? (l.variant ? v(l.variant).name : l.id);
}
export function lineSku(l: OrdLine): string {
  return l.sku ?? (l.variant ? v(l.variant).sku : '');
}
export function lineImage(l: OrdLine): string | undefined {
  return l.image ?? (l.variant ? v(l.variant).image : undefined);
}
/** Lines that hold physical stock (not the bundle parent, not services, not ignored or removed). */
export const isStockLine = (l: OrdLine): boolean => (l.kind === 'goods' || l.kind === 'component' || l.kind === 'gift') && !l.removed;
export const isPaidLine = (l: OrdLine): boolean => (l.kind === 'goods' || l.kind === 'bundle' || l.kind === 'service') && !l.removed;

export function linesTotal(lines: OrdLine[]): number {
  return lines.filter(isPaidLine).reduce((a, l) => a + l.unitPrice * l.qty, 0);
}
export function listTotal(lines: OrdLine[]): number {
  return lines.filter((l) => !l.removed && (l.kind === 'goods' || l.kind === 'bundle' || l.kind === 'service' || l.kind === 'gift')).reduce((a, l) => a + (l.listPrice ?? l.unitPrice) * l.qty, 0);
}
export function giftCostOf(lines: OrdLine[]): number | null {
  let sum = 0;
  for (const l of lines) {
    if (l.kind !== 'gift' || l.removed || !l.variant) continue;
    const c = v(l.variant).cost;
    if (c === null) return null;
    sum += c * l.qty;
  }
  return sum;
}

/* ── Shared timeline fragments ─────────────────────────────────────── */

const T = (day: number, hm: string): string => `2026-11-${String(day).padStart(2, '0')}T${hm}:00+01:00`;

const OK: OrdBadge = { label: 'Zsynchronizowane', tone: 'success' };
const ATTN: OrdBadge = { label: 'Wymaga uwagi', tone: 'error' };
const WAIT: OrdBadge = { label: 'Czeka', tone: 'warning' };
const TO_PACK: OrdBadge = { label: 'Do spakowania', tone: 'info' };
const PACKED: OrdBadge = { label: 'Spakowane', tone: 'success' };
const HELD: OrdBadge = { label: 'Wstrzymane', tone: 'warning' };

const reserved: OrdBadge = { label: 'Zarezerwowano', tone: 'success' };

/* ── Scenarios ─────────────────────────────────────────────────────── */

const morningV1 = (id = 'L1') => bundle(id, 'morning', 1, 1, {}, { status: reserved });

const spoonPromo = (forLine = 'L1'): OrdLine =>
  gift(`ol-gift:promo-spoon:${forLine}`, 'spoon', 1, 'ol-rule', { olOnly: true, status: reserved, note: 'Promocja: Łyżeczka gratis do zestawu porannego' });

const allegroBundlePayload = (offerQty = 1, extraLines: { text: string; tone?: 'warn' | 'muted' | 'key' }[] = []) => ({
  title: 'Co przysłało Allegro (checkout-form, lineItems)',
  lines: [
    { text: '"lineItems": [{' },
    { text: '  "id": "L1",' },
    { text: '  "offer": { "id": "17845521093", "name": "Zestaw poranny: kubek + kawa Etiopia" },', tone: 'key' as const },
    { text: `  "quantity": ${offerQty},` },
    { text: '  "price": { "amount": "64.99", "currency": "PLN" },' },
    { text: '  "productSet": [', tone: 'key' as const },
    { text: '    { "product": { "id": "kubek-350-bialy" }, "quantity": 1 },' },
    { text: '    { "product": { "id": "kawa-etiopia-250" }, "quantity": 1 }' },
    { text: '  ]' },
    { text: '}]' },
    ...extraLines,
  ],
});

const base = (s: Partial<OrdScenario> & Pick<OrdScenario, 'id' | 'lines'>): OrdScenario => ({
  number: 'a3c9e0f2',
  channel: 'allegro',
  placedAt: T(3, '09:14'),
  buyer: 'Anna Kowalska',
  city: 'Kraków',
  health: OK,
  phase: TO_PACK,
  payment: 'Opłacone',
  stage: 'reserved',
  adjustments: [],
  shipping: 999,
  delivery: 'Allegro Paczkomaty InPost',
  timeline: [],
  ...s,
});

const ingest = (at: string, channel: string): OrdEvent => ({ at, title: `Zamówienie przyszło z ${channel}`, by: 'system · pobranie', tone: 'default' });

export const ORDER_SCENARIOS: Record<string, OrdScenario> = {
  'bundle-allegro': base({
    id: 'bundle-allegro',
    placedAt: T(1, '20:14'),
    lines: morningV1(),
    adjustments: [{ label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller', note: 'Kubek 39,99 + kawa 34,99 = 74,98 zł' }],
    payload: allegroBundlePayload(),
    timeline: [
      ingest(T(1, '20:14'), 'Allegro'),
      { at: T(1, '20:14'), title: 'Rozpoznano zestaw "Zestaw poranny" (wersja 1)', by: 'system', desc: 'Oferta jest powiązana z zestawem. Skład zamrożono na wersji z chwili złożenia zamówienia.', tone: 'default' },
      { at: T(1, '20:15'), title: 'Zarezerwowano składniki: Kubek x1, Kawa x1', by: 'system · rezerwacja', tone: 'success' },
      { at: T(2, '11:02'), title: 'Zestaw zmieniono na wersję 2 (z łyżeczką)', by: 'Marta (operator)', desc: 'To zamówienie dalej trzyma wersję 1.', tone: 'default' },
    ],
  }),

  'gift-ol-only': base({
    id: 'gift-ol-only',
    placedAt: T(1, '21:40'),
    number: 'b71d4a95',
    buyer: 'Piotr Nowak',
    city: 'Poznań',
    lines: [...morningV1(), spoonPromo()],
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Nie ma go w sumie Allegro. Wartość katalogowa 14,99 zł.' },
    ],
    payload: allegroBundlePayload(1, [{ text: '// brak pozycji gratisu: Allegro nie ma gratisów', tone: 'muted' }]),
    writeback: true,
    timeline: [
      ingest(T(1, '21:40'), 'Allegro'),
      { at: T(1, '21:40'), title: 'Promocja dodała gratis: Łyżeczka do kawy x1', by: 'system · promocja', desc: 'Reguła "Łyżeczka gratis do zestawu porannego" (wersja 2) pasuje: zamówienie zawiera ZES-PORANNY. Pozycja ol-gift:promo-spoon:L1.', tone: 'success' },
      { at: T(1, '21:41'), title: 'Zarezerwowano: Kubek x1, Kawa x1, Łyżeczka x1 (gratis)', by: 'system · rezerwacja', tone: 'success' },
    ],
  }),

  'gift-cart-rule': base({
    id: 'gift-cart-rule',
    number: 'KWS-10482',
    channel: 'prestashop',
    buyer: 'Ewa Zielińska',
    city: 'Gdańsk',
    delivery: 'Kurier DPD',
    shipping: 1490,
    lines: [
      goods('1', 'mug', 2, undefined, { status: reserved }),
      gift('2', 'bag', 1, 'cart-rule', { unitPrice: 999, status: reserved, note: 'Przyszła jako zwykła pozycja w pełnej cenie 9,99 zł' }),
    ],
    adjustments: [{ label: 'Rabat z reguły koszyka "Torba gratis przy 2 kubkach"', amount: -999, funder: 'seller', note: 'PrestaShop podał rabat na całym zamówieniu. OpenLinker przypisał go do torby.' }],
    payload: {
      title: 'Co przysłał PrestaShop (orders/10482)',
      lines: [
        { text: '"order_rows": [' },
        { text: '  { "product_reference": "KUB-350-BI", "product_quantity": 2, "unit_price_tax_incl": "39.99" },' },
        { text: '  { "product_reference": "TOR-PREZ", "product_quantity": 1, "unit_price_tax_incl": "9.99" }', tone: 'key' },
        { text: '],' },
        { text: '"order_cart_rules": [', tone: 'key' },
        { text: '  { "name": "Torba gratis przy 2 kubkach", "value": "9.99", "free_shipping": "0" }', tone: 'warn' },
        { text: ']' },
      ],
    },
    timeline: [
      ingest(T(3, '09:14'), 'PrestaShop'),
      { at: T(3, '09:14'), title: 'Rozpoznano gratis z reguły koszyka: Torba prezentowa kraft', by: 'system', desc: 'Rabat 9,99 zł z reguły koszyka równa się cenie pozycji. Pozycja oznaczona jako gratis.', tone: 'success' },
    ],
  }),

  'gift-inferred': base({
    id: 'gift-inferred',
    number: '#20817',
    channel: 'shoper',
    buyer: 'Tomasz Wiśniewski',
    city: 'Wrocław',
    delivery: 'Kurier InPost',
    shipping: 1299,
    lines: [goods('1', 'tea', 2, undefined, { status: reserved }), gift('2', 'spoon', 1, 'inferred', { unitPrice: 1, status: reserved, note: 'Wariant "Łyżeczka (gratis)" za 0,01 zł z aplikacji Gratisy' })],
    adjustments: [{ label: 'Gratis: Łyżeczka do kawy', amount: -1498, funder: 'seller', note: 'Klient zapłacił 0,01 zł zamiast 14,99 zł' }],
    payload: {
      title: 'Co przysłał Shoper (orders/20817/products)',
      lines: [
        { text: '{ "code": "HER-100-CZ", "quantity": 2, "price": "19.99" },' },
        { text: '{ "code": "LYZ-KAW-GRATIS", "name": "Łyżeczka (gratis)", "quantity": 1, "price": "0.01" }', tone: 'warn' },
        { text: '// Shoper nie oznacza gratisu. Rozpoznano po regule operatora.', tone: 'muted' },
      ],
    },
    timeline: [
      ingest(T(3, '09:14'), 'Shoper'),
      { at: T(3, '09:14'), title: 'Rozpoznano gratis po cenie 0,01 zł', by: 'system · reguła operatora', desc: 'Reguła połączenia: "Pozycja za 0,01 zł z kodem kończącym się na -GRATIS to gratis".', tone: 'success' },
    ],
  }),

  'gift-channel-flag': base({
    id: 'gift-channel-flag',
    number: 'IDO-3381',
    channel: 'idosell',
    buyer: 'Katarzyna Lewandowska',
    city: 'Łódź',
    delivery: 'Kurier GLS',
    shipping: 1490,
    lines: [goods('1', 'press', 1, undefined, { status: reserved }), gift('2', 'bag', 1, 'channel-flag', { status: reserved })],
    adjustments: [{ label: 'Gratis: Torba prezentowa kraft', amount: -999, funder: 'seller', note: 'IdoSell oznaczył pozycję jako gratis' }],
    payload: {
      title: 'Co przysłał IdoSell (orders/IDO-3381, productsResults)',
      lines: [
        { text: '{ "productCode": "ZAP-FP-800", "productQuantity": 1, "productOrderPrice": 89.00 },' },
        { text: '{ "productCode": "TOR-PREZ", "productQuantity": 1, "productOrderPrice": 0,' },
        { text: '  "orderSalesMode": "gift" }', tone: 'warn' },
      ],
    },
    timeline: [ingest(T(3, '09:14'), 'IdoSell'), { at: T(3, '09:14'), title: 'Kanał oznaczył gratis: Torba prezentowa kraft', by: 'system', tone: 'success' }],
  }),

  'gift-channel-flag-empik': base({
    id: 'gift-channel-flag-empik',
    number: 'EMP-90233-A',
    channel: 'empik',
    buyer: 'Joanna Wójcik',
    city: 'Lublin',
    delivery: 'Empik Paczka',
    shipping: 990,
    lines: [goods('1', 'book', 1, undefined, { status: reserved }), gift('2', 'bag', 1, 'channel-flag', { status: reserved, funder: 'unknown', note: 'Empik podał ilość gratisową bez informacji, kto ją finansuje' })],
    adjustments: [{ label: 'Gratis: Torba prezentowa kraft', amount: -999, funder: 'unknown', note: 'Kanał nie podał, kto finansuje' }],
    payload: {
      title: 'Co przysłał Empik (Mirakl, order_lines)',
      lines: [
        { text: '{ "offer_sku": "KSI-PARZ", "quantity": 1, "price": 49.00 },' },
        { text: '{ "offer_sku": "TOR-PREZ", "quantity": 1, "price": 0.00,' },
        { text: '  "offered_quantity": 1 }', tone: 'warn' },
      ],
    },
    timeline: [ingest(T(3, '09:14'), 'Empik'), { at: T(3, '09:14'), title: 'Kanał oznaczył gratis (offered_quantity): Torba prezentowa kraft', by: 'system', tone: 'success' }],
  }),

  'bundle-plus-gift': base({
    id: 'bundle-plus-gift',
    number: 'ERL-55210',
    channel: 'erli',
    placedAt: T(3, '18:22'),
    buyer: 'Michał Kamiński',
    city: 'Szczecin',
    delivery: 'Erli Paczkomaty InPost',
    lines: bundle('L1', 'morning', 2, 1, {}, { status: reserved }),
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis w składzie zestawu: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Wartość katalogowa, nie wlicza się do sumy' },
    ],
    timeline: [
      ingest(T(3, '18:22'), 'Erli'),
      { at: T(3, '18:22'), title: 'Rozpoznano zestaw "Zestaw poranny" (wersja 2)', by: 'system', desc: 'Wersja 2 ma w składzie łyżeczkę jako gratis. Pozycja L1~g:spoon.', tone: 'default' },
      { at: T(3, '18:22'), title: 'Promocja "Łyżeczka gratis do zestawu porannego" pominięta', by: 'system · promocja', desc: 'Gratis jest już w składzie zestawu. Drugiej łyżeczki nie dodano.', tone: 'default' },
      { at: T(3, '18:23'), title: 'Zarezerwowano: Kubek x1, Kawa x1, Łyżeczka x1 (gratis)', by: 'system · rezerwacja', tone: 'success' },
    ],
  }),

  'gift-out-of-stock': base({
    id: 'gift-out-of-stock',
    number: 'c2e81b07',
    placedAt: T(4, '07:55'),
    buyer: 'Agnieszka Dąbrowska',
    city: 'Rzeszów',
    health: ATTN,
    phase: HELD,
    lines: [...morningV1(), { ...spoonPromo(), status: { label: 'Brak na stanie', tone: 'error' }, trail: [{ label: 'Nie zarezerwowano', state: 'blocked', detail: 'dostępne 0 szt.' }, { label: 'Czeka na decyzję', state: 'todo' }] }],
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Wartość katalogowa' },
    ],
    timeline: [
      ingest(T(4, '07:55'), 'Allegro'),
      { at: T(4, '07:55'), title: 'Promocja dodała gratis: Łyżeczka do kawy x1', by: 'system · promocja', tone: 'default' },
      { at: T(4, '07:55'), title: 'Nie udało się zarezerwować gratisu: brak na stanie', by: 'system · rezerwacja', desc: 'Łyżeczka: 4 szt. w PrestaShop, 4 szt. obiecane innym zamówieniom.', tone: 'error' },
    ],
  }),

  'add-gift': base({
    id: 'add-gift',
    number: 'd90f3c6a',
    placedAt: T(3, '12:30'),
    buyer: 'Krzysztof Mazur',
    city: 'Katowice',
    lines: [goods('L1', 'coffee', 2, undefined, { status: reserved }), goods('L2', 'mug', 1, undefined, { status: reserved })],
    timeline: [
      ingest(T(3, '12:30'), 'Allegro'),
      { at: T(3, '12:31'), title: 'Zarezerwowano: Kawa x2, Kubek x1', by: 'system · rezerwacja', tone: 'success' },
      { at: T(4, '08:10'), title: 'Klient napisał: przesyłka z poprzedniego zamówienia przyszła uszkodzona', by: 'Allegro · wiadomość', tone: 'default' },
    ],
  }),

  'multipack-held': base({
    id: 'multipack-held',
    number: 'e5a7720d',
    placedAt: T(4, '06:41'),
    buyer: 'Paweł Grabowski',
    city: 'Bydgoszcz',
    health: ATTN,
    phase: HELD,
    lines: [
      {
        ...goods('L1', 'coffee', 1, 9499),
        name: 'Kawa Etiopia 250 g, 3 opakowania (oferta)',
        listPrice: 9499,
        status: { label: 'Wstrzymane', tone: 'warning' },
        note: 'Oferta powiązana z jednym wariantem: Kawa ziarnista Etiopia 250 g',
        trail: [{ label: 'Nie zarezerwowano', state: 'blocked', detail: 'czeka na definicję zestawu' }],
      },
    ],
    payload: {
      title: 'Co przysłało Allegro (lineItems)',
      lines: [
        { text: '{ "id": "L1", "offer": { "id": "17845599120", "name": "Kawa Etiopia 3 x 250 g" },' },
        { text: '  "quantity": 1, "price": { "amount": "94.99", "currency": "PLN" },' },
        { text: '  "productSet": [ { "product": { "id": "kawa-etiopia-250" }, "quantity": 3 } ] }', tone: 'warn' },
      ],
    },
    timeline: [
      ingest(T(4, '06:41'), 'Allegro'),
      { at: T(4, '06:41'), title: 'Pozycja wstrzymana: oferta to 3 sztuki jednego produktu', by: 'system', desc: 'Allegro podało w productSet ilość 3, a oferta jest powiązana z pojedynczym wariantem bez definicji zestawu.', tone: 'warning' },
    ],
  }),

  'shoper-double-children': base({
    id: 'shoper-double-children',
    number: '#20844',
    channel: 'shoper',
    buyer: 'Natalia Pawlak',
    city: 'Olsztyn',
    delivery: 'Kurier InPost',
    shipping: 1299,
    lines: [
      ...bundle('1', 'brew', 1, 1, {}, { status: reserved }),
      { id: '2', kind: 'ignored', variant: 'press', qty: 1, unitPrice: 0, note: 'Shoper przysłał składnik jako osobną pozycję' },
      { id: '3', kind: 'ignored', variant: 'coffee', qty: 2, unitPrice: 0, note: 'Shoper przysłał składnik jako osobną pozycję' },
    ],
    adjustments: [{ label: 'Zestaw taniej niż osobno', amount: -1998, funder: 'seller', note: 'French press 89,00 + kawa 2 x 34,99 = 158,98 zł' }],
    payload: {
      title: 'Co przysłał Shoper (orders/20844/products)',
      lines: [
        { text: '{ "code": "ZES-PARZENIE", "quantity": 1, "price": "139.00", "bundle": true },', tone: 'key' },
        { text: '{ "code": "ZAP-FP-800", "quantity": 1, "price": "0.00", "parent": "ZES-PARZENIE" },', tone: 'muted' },
        { text: '{ "code": "KAW-250-ETI", "quantity": 2, "price": "0.00", "parent": "ZES-PARZENIE" }', tone: 'muted' },
      ],
    },
    timeline: [
      ingest(T(3, '09:14'), 'Shoper'),
      { at: T(3, '09:14'), title: 'Pominięto 2 pozycje składników przysłane przez Shoper', by: 'system', desc: 'Składniki pasują do definicji zestawu "Zestaw do parzenia". Bez tego kroku stan zszedłby podwójnie.', tone: 'default' },
    ],
  }),

  'bundle-edit-refused': base({
    id: 'bundle-edit-refused',
    number: 'f3b04e12',
    lines: [...bundle('L1', 'brew', 1, 1, {}, { status: reserved }), goods('L2', 'tea', 1, undefined, { status: reserved })],
    adjustments: [{ label: 'Zestaw taniej niż osobno', amount: -1998, funder: 'seller' }],
    timeline: [ingest(T(3, '09:14'), 'Allegro'), { at: T(3, '09:15'), title: 'Zarezerwowano: French press x1, Kawa x2, Herbata x1', by: 'system · rezerwacja', tone: 'success' }],
  }),

  'customer-limit-reached': base({
    id: 'customer-limit-reached',
    number: '0a6e19c4',
    buyer: 'Anna Kowalska',
    lines: [goods('L1', 'press', 1, undefined, { status: reserved }), goods('L2', 'coffee', 2, undefined, { status: reserved })],
    timeline: [
      ingest(T(3, '09:14'), 'Allegro'),
      { at: T(3, '09:14'), title: 'Promocja "Próbka kawy przy zakupach od 150 zł" nie dodała gratisu', by: 'system · promocja', desc: 'Limit 1 gratis na klienta wykorzystany 12 października (zamówienie 7d21f0aa).', tone: 'default' },
    ],
  }),

  'gift-removed-below-threshold': base({
    id: 'gift-removed-below-threshold',
    number: '5c11d8b3',
    lines: [
      goods('L1', 'press', 1, undefined, { status: reserved }),
      goods('L2', 'coffee', 1, undefined, { status: reserved, note: 'Ilość zmieniona w edycji: 2 -> 1' }),
      gift('ol-gift:promo-sample:order', 'sample', 1, 'ol-rule', { olOnly: true, removed: true, note: 'Koszyk spadł do 123,99 zł, próg promocji to 150 zł' }),
    ],
    timeline: [
      ingest(T(2, '15:20'), 'Allegro'),
      { at: T(2, '15:20'), title: 'Promocja dodała gratis: Próbka kawy Kolumbia 50 g x1', by: 'system · promocja', tone: 'success' },
      { at: T(3, '10:05'), title: 'Zmieniono ilość: Kawa 2 -> 1', by: 'Marta (operator)', desc: 'Klient poprosił o mniejszą ilość.', tone: 'default' },
      { at: T(3, '10:05'), title: 'Gratis usunięty: koszyk poniżej progu promocji', by: 'system · promocja', desc: 'Rezerwacja próbki zwolniona. Stan wrócił do puli.', tone: 'warning' },
    ],
  }),

  'two-rules-matched': base({
    id: 'two-rules-matched',
    number: '9e4b2d71',
    lines: [...bundle('L1', 'morning', 1, 2, {}, { status: reserved }), goods('L2', 'coffee', 1, undefined, { status: reserved }), { ...spoonPromo(), qty: 2, note: 'Promocja: Łyżeczka gratis do zestawu porannego, 1 szt. na każdy zestaw' }],
    adjustments: [
      { label: 'Zestaw taniej niż osobno (x2)', amount: -1998, funder: 'seller' },
      { label: 'Gratis: Łyżeczka do kawy x2', amount: -2998, funder: 'seller', note: 'Wartość katalogowa' },
    ],
    timeline: [
      ingest(T(3, '09:14'), 'Allegro'),
      { at: T(3, '09:14'), title: 'Pasują 2 promocje, zastosowano 1', by: 'system · promocja', desc: 'Zastosowano "Łyżeczka gratis do zestawu porannego" (miejsce 1 na liście). Pominięto "Próbka kawy przy zakupach od 150 zł": nie łączy się z innymi promocjami.', tone: 'default' },
    ],
  }),

  'limit-reached': base({
    id: 'limit-reached',
    number: '#7781',
    channel: 'woocommerce',
    buyer: 'Marek Jankowski',
    city: 'Kielce',
    delivery: 'Kurier InPost',
    shipping: 1490,
    lines: [goods('1', 'mug', 2, undefined, { status: reserved })],
    timeline: [
      ingest(T(3, '09:14'), 'WooCommerce'),
      { at: T(3, '09:14'), title: 'Promocja "Torba prezentowa przy 2 kubkach" nie dodała gratisu', by: 'system · promocja', desc: 'Limit sztuk wyczerpany: wydano 50 z 50 toreb. Promocja wstrzymała się sama.', tone: 'default' },
    ],
  }),

  'gift-wrap': base({
    id: 'gift-wrap',
    number: '7bb0e4f9',
    lines: [
      goods('L1', 'grinder', 1, undefined, { status: reserved }),
      { id: 'svc:gift-wrap', kind: 'service', name: 'Zapakuj na prezent', sku: 'usługa Allegro', qty: 1, unitPrice: 500, listPrice: 500, note: 'Usługa, nie towar. Nie rusza stanu.' },
    ],
    timeline: [
      ingest(T(3, '09:14'), 'Allegro'),
      { at: T(3, '09:14'), title: 'Kupujący zamówił pakowanie na prezent z wiadomością', by: 'system', desc: 'Instrukcja trafiła na stanowisko pakowania.', tone: 'default' },
    ],
  }),

  cancelled: base({
    id: 'cancelled',
    number: '3f7c0b28',
    health: { label: 'Anulowane', tone: 'neutral' },
    phase: { label: 'Anulowane', tone: 'neutral' },
    payment: 'Zwrócono płatność',
    stage: 'cancelled',
    lines: [...morningV1(), spoonPromo()].map((l) => ({ ...l, status: l.kind === 'bundle' ? undefined : { label: 'Zwolniono', tone: 'neutral' as const } })),
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Wartość katalogowa' },
    ],
    timeline: [
      ingest(T(2, '19:02'), 'Allegro'),
      { at: T(2, '19:02'), title: 'Promocja dodała gratis: Łyżeczka do kawy x1', by: 'system · promocja', tone: 'success' },
      { at: T(2, '19:03'), title: 'Zarezerwowano: Kubek x1, Kawa x1, Łyżeczka x1 (gratis)', by: 'system · rezerwacja', tone: 'success' },
      { at: T(3, '08:47'), title: 'Kupujący anulował zamówienie na Allegro', by: 'Allegro', tone: 'warning' },
      { at: T(3, '08:47'), title: 'Rezerwacje zwolnione: Kubek x1, Kawa x1, Łyżeczka x1 (gratis)', by: 'system · rezerwacja', desc: 'Nic nie zeszło ze stanu w PrestaShop, bo paczki nie spakowano. Zadanie pakowania anulowane.', tone: 'success' },
    ],
  }),

  'destination-refused-zero-line': base({
    id: 'destination-refused-zero-line',
    number: '6d2a91fe',
    forceOms: false,
    health: ATTN,
    phase: { label: 'Wysłane do sklepu', tone: 'info' },
    lines: [
      ...morningV1().map((l) => ({ ...l, status: l.kind === 'bundle' ? undefined : { label: 'W PrestaShop', tone: 'success' as const } })),
      {
        ...spoonPromo(),
        status: { label: 'Odrzucona przez sklep', tone: 'error' },
        trail: [
          { label: 'Wysłano do PrestaShop jako pozycja 0,00 zł', state: 'blocked', detail: 'sklep odrzucił pozycję' },
          { label: 'Sklep zdjął stan', state: 'skipped' },
          { label: 'Korekta ręczna', state: 'active', detail: 'czeka na operatora' },
        ],
      },
    ],
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Wartość katalogowa' },
    ],
    timeline: [
      ingest(T(3, '09:14'), 'Allegro'),
      { at: T(3, '09:14'), title: 'Promocja dodała gratis: Łyżeczka do kawy x1', by: 'system · promocja', tone: 'success' },
      { at: T(3, '09:15'), title: 'Utworzono zamówienie w PrestaShop bez pozycji gratisu', by: 'system · PrestaShop', desc: 'Sklep odrzucił pozycję z ceną 0,00 zł. Kubek i kawa przeszły.', tone: 'error' },
    ],
  }),

  'decrement-blocked': base({
    id: 'decrement-blocked',
    number: '28e5f6c0',
    health: ATTN,
    phase: PACKED,
    stage: 'packed',
    lines: [
      ...bundle('L1', 'brew', 1, 1, {}, {
        status: { label: 'Spakowano', tone: 'success' },
        trail: [
          { label: 'Zarezerwowano', state: 'done' },
          { label: 'Spakowano', state: 'done' },
          { label: 'Zdjęcie stanu w PrestaShop', state: 'blocked', detail: 'pak w trybie "zmniejszaj składniki"' },
        ],
      }),
    ],
    adjustments: [{ label: 'Zestaw taniej niż osobno', amount: -1998, funder: 'seller' }],
    timeline: [
      ingest(T(2, '14:00'), 'Allegro'),
      { at: T(3, '10:30'), title: 'Spakowano paczkę 1 z 1', by: 'Ola (pakowacz)', tone: 'success' },
      { at: T(3, '10:30'), title: 'Zdjęcie stanu zablokowane', by: 'system · PrestaShop', desc: 'Produkt "Zestaw do parzenia" w PrestaShop to pak, który zmniejsza stan składników. Zapis przez API zmieniłby tylko wiersz paka, a składniki zostałyby na stanie.', tone: 'error' },
    ],
  }),

  'eur-order': base({
    id: 'eur-order',
    number: 'ERL-55288',
    channel: 'erli',
    currency: 'EUR',
    buyer: 'Lena Fischer',
    city: 'Görlitz',
    health: { label: 'Do przeglądu', tone: 'review' },
    delivery: 'Erli, wysyłka do Niemiec',
    shipping: 2125,
    lines: [...bundle('L1', 'morning', 2, 1, {}, { status: reserved }).map((l) => (l.kind === 'component' ? { ...l, vatLabel: l.variant === 'mug' ? '19% (DE)' : '7% (DE)' } : l))],
    adjustments: [
      { label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' },
      { label: 'Gratis w składzie zestawu: Łyżeczka do kawy', amount: -1499, funder: 'seller', note: 'Wartość katalogowa' },
    ],
    timeline: [
      ingest(T(3, '09:14'), 'Erli'),
      { at: T(3, '09:14'), title: 'Zamówienie w EUR ze stawkami VAT Niemiec', by: 'system', desc: 'Erli podało walutę EUR i stawki 19% / 7%. Wcześniej takie zamówienia zapisywały się jako PLN.', tone: 'conflict' },
    ],
  }),

  'pilot-mode': base({
    id: 'pilot-mode',
    number: '41aa7d3e',
    lines: morningV1(),
    adjustments: [{ label: 'Zestaw taniej niż osobno', amount: -999, funder: 'seller' }],
    timeline: [
      ingest(T(3, '09:14'), 'Allegro'),
      { at: T(3, '09:20'), title: 'Notatka dla pakowacza: dołóż łyżeczkę do kawy (gratis)', by: 'Marta (operator)', tone: 'default' },
    ],
  }),
};

/* ── Orders list rows ──────────────────────────────────────────────── */

export interface ListRow {
  id: string;
  number: string;
  channel: ChannelId;
  dest: string;
  buyer: string;
  city: string;
  firstItem: string;
  image: string;
  items: number;
  total: number;
  createdAt: string;
  health: OrdBadge;
  phase: OrdBadge;
  hold?: string;
  stockRisk?: string;
  edited?: boolean;
  bundle?: boolean;
  gift?: GiftSource | 'none';
  attention?: string;
  packing?: string;
  /** Order detail state this row opens. */
  state: string;
  shipment: OrdBadge;
}

const row = (r: ListRow): ListRow => r;

export const LIST_ROWS: ListRow[] = [
  row({ id: 'r1', number: 'b71d4a95', channel: 'allegro', dest: 'OpenLinker', buyer: 'Piotr Nowak', city: 'Poznań', firstItem: 'Zestaw poranny', image: BUNDLES.morning.image, items: 2, total: 7498, createdAt: T(1, '21:40'), health: OK, phase: TO_PACK, bundle: true, gift: 'ol-rule', state: 'gift-ol-only', packing: 'Do spakowania', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r2', number: 'c2e81b07', channel: 'allegro', dest: 'OpenLinker', buyer: 'Agnieszka Dąbrowska', city: 'Rzeszów', firstItem: 'Zestaw poranny', image: BUNDLES.morning.image, items: 2, total: 7498, createdAt: T(4, '07:55'), health: ATTN, phase: HELD, bundle: true, gift: 'ol-rule', hold: 'Gratis bez stanu', attention: 'gift-out-of-stock', state: 'gift-out-of-stock', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r3', number: 'KWS-10482', channel: 'prestashop', dest: 'PrestaShop', buyer: 'Ewa Zielińska', city: 'Gdańsk', firstItem: 'Kubek ceramiczny 350 ml, biały', image: v('mug').image, items: 2, total: 9488, createdAt: T(3, '09:14'), health: OK, phase: TO_PACK, gift: 'cart-rule', state: 'gift-cart-rule', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r4', number: 'e5a7720d', channel: 'allegro', dest: 'OpenLinker', buyer: 'Paweł Grabowski', city: 'Bydgoszcz', firstItem: 'Kawa Etiopia 250 g, 3 opakowania', image: BUNDLES.triple.image, items: 1, total: 10498, createdAt: T(4, '06:41'), health: ATTN, phase: HELD, hold: 'Multipak bez definicji', attention: 'multipack', state: 'multipack-held', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r5', number: '28e5f6c0', channel: 'allegro', dest: 'OpenLinker', buyer: 'Jan Kaczmarek', city: 'Opole', firstItem: 'Zestaw do parzenia', image: BUNDLES.brew.image, items: 1, total: 14899, createdAt: T(2, '14:00'), health: ATTN, phase: PACKED, bundle: true, attention: 'decrement-blocked', stockRisk: 'Zdjęcie stanu zablokowane', state: 'decrement-blocked', packing: 'Spakowane', shipment: { label: 'Spakowane', tone: 'success' } }),
  row({ id: 'r6', number: '#20817', channel: 'shoper', dest: 'Shoper', buyer: 'Tomasz Wiśniewski', city: 'Wrocław', firstItem: 'Herbata czarna Assam 100 g', image: v('tea').image, items: 2, total: 5298, createdAt: T(3, '09:14'), health: OK, phase: TO_PACK, gift: 'inferred', state: 'gift-inferred', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r7', number: 'ERL-55288', channel: 'erli', dest: 'OpenLinker', buyer: 'Lena Fischer', city: 'Görlitz', firstItem: 'Zestaw poranny', image: BUNDLES.morning.image, items: 1, total: 8624, createdAt: T(3, '09:14'), health: { label: 'Do przeglądu', tone: 'review' }, phase: TO_PACK, bundle: true, gift: 'ol-rule', attention: 'eur', state: 'eur-order', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r8', number: 'a3c9e0f2', channel: 'allegro', dest: 'OpenLinker', buyer: 'Anna Kowalska', city: 'Kraków', firstItem: 'Zestaw poranny', image: BUNDLES.morning.image, items: 1, total: 7498, createdAt: T(1, '20:14'), health: OK, phase: TO_PACK, bundle: true, state: 'bundle-allegro', packing: 'W pakowaniu', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r9', number: 'f8c3a210', channel: 'allegro', dest: 'OpenLinker', buyer: 'Zofia Wróbel', city: 'Gliwice', firstItem: 'Zestaw do parzenia', image: BUNDLES.brew.image, items: 1, total: 14899, createdAt: T(4, '08:02'), health: ATTN, phase: { label: 'Czeka: stan', tone: 'warning' }, bundle: true, hold: 'Routing odmówił', attention: 'routing-refused', state: 'bundle-edit-refused', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r10', number: '6d2a91fe', channel: 'allegro', dest: 'PrestaShop', buyer: 'Robert Szymański', city: 'Toruń', firstItem: 'Zestaw poranny', image: BUNDLES.morning.image, items: 2, total: 7498, createdAt: T(3, '09:14'), health: ATTN, phase: { label: 'Wysłane do sklepu', tone: 'info' }, bundle: true, gift: 'ol-rule', attention: 'gift-rule-failed', state: 'destination-refused-zero-line', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r11', number: 'IDO-3381', channel: 'idosell', dest: 'IdoSell', buyer: 'Katarzyna Lewandowska', city: 'Łódź', firstItem: 'Zaparzacz French press 800 ml', image: v('press').image, items: 2, total: 10390, createdAt: T(3, '09:14'), health: OK, phase: TO_PACK, gift: 'channel-flag', state: 'gift-channel-flag', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r12', number: '5c11d8b3', channel: 'allegro', dest: 'OpenLinker', buyer: 'Iwona Krawczyk', city: 'Płock', firstItem: 'Zaparzacz French press 800 ml', image: v('press').image, items: 2, total: 13398, createdAt: T(2, '15:20'), health: OK, phase: TO_PACK, edited: true, state: 'gift-removed-below-threshold', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
  row({ id: 'r13', number: '#7781', channel: 'woocommerce', dest: 'WooCommerce', buyer: 'Marek Jankowski', city: 'Kielce', firstItem: 'Kubek ceramiczny 350 ml, biały', image: v('mug').image, items: 1, total: 9488, createdAt: T(3, '09:14'), health: OK, phase: { label: 'Wysłane', tone: 'success' }, state: 'limit-reached', shipment: { label: 'Wysłane', tone: 'success' } }),
  row({ id: 'r14', number: '7bb0e4f9', channel: 'allegro', dest: 'OpenLinker', buyer: 'Beata Michalska', city: 'Sopot', firstItem: 'Młynek ręczny, żarna ceramiczne', image: v('grinder').image, items: 2, total: 14399, createdAt: T(3, '09:14'), health: OK, phase: TO_PACK, state: 'gift-wrap', shipment: { label: 'Niewysłane', tone: 'neutral' } }),
];

export interface InboxItem {
  key: string;
  count: number;
  title: string;
  hint: string;
  tone: 'error' | 'warning' | 'review';
  screen: string;
  state: string;
}

export const INBOX: InboxItem[] = [
  { key: 'gift-out-of-stock', count: 3, title: 'Gratis bez stanu', hint: 'Łyżeczka do kawy skończyła się w trakcie promocji. Wybierz zamiennik, pomiń albo wstrzymaj.', tone: 'error', screen: 'order', state: 'gift-out-of-stock' },
  { key: 'gift-rule-failed', count: 1, title: 'Reguła gratisu nie zadziałała', hint: 'Sklep docelowy odrzucił pozycję 0,00 zł. Zamówienie poszło dalej bez gratisu.', tone: 'error', screen: 'order', state: 'destination-refused-zero-line' },
  { key: 'decrement-blocked', count: 2, title: 'Zdjęcie stanu zablokowane', hint: 'PrestaShop ma ten zestaw jako pak zmniejszający składniki. Stan trzeba zdjąć ręcznie.', tone: 'error', screen: 'order', state: 'decrement-blocked' },
  { key: 'routing-refused', count: 1, title: 'Routing odmówił na składniku', hint: 'French press nie ma stanu w żadnej lokalizacji. Zestaw czeka na dostawę.', tone: 'warning', screen: 'order', state: 'bundle-edit-refused' },
  { key: 'eur', count: 4, title: 'Zamówienie w EUR do przeglądu', hint: 'Erli przysłało walutę EUR i stawki VAT Niemiec. Sprawdź dokument przed wystawieniem.', tone: 'review', screen: 'order', state: 'eur-order' },
  { key: 'multipack', count: 2, title: 'Multipak wstrzymany', hint: 'Oferta to kilka sztuk jednego produktu bez definicji zestawu. Zdefiniuj zestaw, żeby zwolnić.', tone: 'warning', screen: 'order', state: 'multipack-held' },
];

/* ── Bench ──────────────────────────────────────────────────────────── */

export interface BenchLine {
  id: string;
  variant: string;
  required: number;
  verified: number;
  gift?: boolean;
  partOf?: string;
  bin?: string;
}
