/**
 * Data and pure rules for the documents lab and the returns screens.
 * Wraps calc.buildDocument so every document total equals what the buyer paid
 * (the 1 grosz of a symbolic gift is taken from a paid line, never added on top).
 */
import { BUNDLES, DOC_PROVIDERS, VARIANTS, type DocProvider, type GiftDocTreatment } from '../model/catalog';
import { buildDocument, latest, splitBundlePrice, vatOfGross, type DocInput, type DocLine, type DocResult } from '../model/calc';

/* ── Scenarios ─────────────────────────────────────────────────────── */

export type ScenarioId = 'morning-spoon' | 'coffee-mug' | 'brew' | 'erli-eur' | 'gift-wrap';
export type TreatmentChoice = GiftDocTreatment | 'rebate-100';
export type BundleMode = 'one-line' | 'components';

export interface Scenario {
  id: ScenarioId;
  label: string;
  channel: string;
  paidLines: DocInput['paidLines'];
  /** Lines that are a paid service (gift wrap): no stock, own rate. */
  serviceNames?: string[];
  gift?: { variant: string; qty: number };
  /** What the buyer paid in grosze (PLN). */
  paid: number;
  hasBundle: boolean;
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  'morning-spoon': {
    id: 'morning-spoon',
    label: 'Zestaw poranny + łyżeczka gratis',
    channel: 'Allegro',
    paidLines: [{ name: 'Zestaw poranny', qty: 1, unitGross: BUNDLES.morning.price, vat: 23, bundle: 'morning' }],
    gift: { variant: 'spoon', qty: 1 },
    paid: BUNDLES.morning.price,
    hasBundle: true,
  },
  'coffee-mug': {
    id: 'coffee-mug',
    label: 'Kawa (5%) + kubek gratis (23%)',
    channel: 'Allegro',
    paidLines: [{ name: VARIANTS.coffee.name, qty: 1, unitGross: VARIANTS.coffee.price, vat: VARIANTS.coffee.vat }],
    gift: { variant: 'mug', qty: 1 },
    paid: VARIANTS.coffee.price,
    hasBundle: false,
  },
  brew: {
    id: 'brew',
    label: 'Zestaw do parzenia',
    channel: 'PrestaShop',
    paidLines: [{ name: 'Zestaw do parzenia', qty: 1, unitGross: BUNDLES.brew.price, vat: 23, bundle: 'brew' }],
    paid: BUNDLES.brew.price,
    hasBundle: true,
  },
  'erli-eur': {
    id: 'erli-eur',
    label: 'Zamówienie EUR na Erli z niemieckim VAT',
    channel: 'Erli',
    paidLines: [],
    paid: 0,
    hasBundle: false,
  },
  'gift-wrap': {
    id: 'gift-wrap',
    label: 'Zamówienie z płatnym pakowaniem na prezent',
    channel: 'Allegro',
    paidLines: [
      { name: VARIANTS.mug.name, qty: 1, unitGross: VARIANTS.mug.price, vat: VARIANTS.mug.vat },
      { name: 'Pakowanie na prezent', qty: 1, unitGross: 990, vat: 23 },
    ],
    serviceNames: ['Pakowanie na prezent'],
    paid: VARIANTS.mug.price + 990,
    hasBundle: false,
  },
};

export const SCENARIO_ORDER: ScenarioId[] = ['morning-spoon', 'coffee-mug', 'brew', 'erli-eur', 'gift-wrap'];

export const TREATMENT_LABEL: Record<TreatmentChoice, string> = {
  omit: 'Pomiń gratis (domyślnie)',
  hold: 'Nie ustawiono',
  grosz: '0,01 zł z płatnej pozycji w tej samej stawce',
  'priced-in': 'Udział w zapłaconej kwocie',
  'internal-record': 'Ewidencja wewnętrzna (art. 7 ust. 2)',
  'rebate-100': 'Cena katalogowa i rabat 100% (niedostępne)',
};

export const TREATMENT_ORDER: TreatmentChoice[] = ['omit', 'grosz', 'priced-in', 'internal-record', 'rebate-100'];

export const PROVIDER_ORDER: DocProvider[] = ['eparagony', 'ksef', 'infakt', 'subiekt'];

/** Which documents a provider issues. */
export function issues(provider: DocProvider): { receipt: boolean; invoice: boolean } {
  if (provider === 'eparagony') return { receipt: true, invoice: false };
  if (provider === 'subiekt') return { receipt: true, invoice: true };
  return { receipt: false, invoice: true };
}

/* ── Composition ───────────────────────────────────────────────────── */

export function ratesOf(lines: DocLine[]): DocResult['perRate'] {
  const m = new Map<number, number>();
  for (const l of lines) if (l.kind !== 'rebate') m.set(l.vat, (m.get(l.vat) ?? 0) + l.gross);
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([rate, gross]) => ({ rate, gross, vat: vatOfGross(gross, rate) }));
}

/** A line whose value does not divide by its quantity becomes two lines, so qty x unit = value on paper. */
function splitUneven(lines: DocLine[]): DocLine[] {
  const out: DocLine[] = [];
  for (const l of lines) {
    if (l.qty > 1 && l.gross % l.qty !== 0) {
      const unit = Math.floor(l.gross / l.qty);
      const extra = l.gross - unit * l.qty;
      out.push({ ...l, qty: l.qty - extra, unitGross: unit, gross: unit * (l.qty - extra) });
      out.push({ ...l, qty: extra, unitGross: unit + 1, gross: (unit + 1) * extra, note: `${l.note ? `${l.note}, ` : ''}reszta z podziału` });
    } else out.push(l);
  }
  return out;
}

export function finalize(lines: DocLine[], status: DocResult['status'], reason?: string, internalRecord?: DocResult['internalRecord']): DocResult {
  const rows = splitUneven(lines);
  return { status, reason, lines: rows, total: rows.reduce((a, l) => a + l.gross, 0), perRate: ratesOf(rows), internalRecord };
}

export interface LabConfig {
  scenario: ScenarioId;
  treatment: TreatmentChoice;
  bundleMode: BundleMode;
  provider: DocProvider;
}

export function composeDoc(cfg: LabConfig): DocResult {
  const sc = SCENARIOS[cfg.scenario];
  const treatment: GiftDocTreatment = cfg.treatment === 'rebate-100' ? 'grosz' : cfg.treatment;
  const base = buildDocument({
    paidLines: sc.paidLines,
    gift: sc.gift,
    giftTreatment: treatment,
    bundleMode: cfg.bundleMode,
    refusesZeroRate: cfg.provider === 'eparagony',
  });
  const lines = base.lines.map((l) =>
    sc.serviceNames?.includes(l.name) ? { ...l, kind: 'service' as const, note: 'usługa, bez stanu magazynowego' } : l,
  );
  return finalize(lines, base.status, base.reason, base.internalRecord);
}

/** The same order sent with the gift as a channel 0,00 line, alone in its rate (eparagony errorCode 41). */
export function zeroLineDoc(cfg: LabConfig): DocResult {
  const sc = SCENARIOS[cfg.scenario];
  const paid = buildDocument({ paidLines: sc.paidLines, giftTreatment: 'omit', bundleMode: cfg.bundleMode, refusesZeroRate: false });
  const g = sc.gift ? VARIANTS[sc.gift.variant] : VARIANTS.mug;
  const lines: DocLine[] = [...paid.lines, { name: `${g.name} (gratis)`, qty: 1, unitGross: 0, gross: 0, vat: g.vat, kind: 'gift', note: 'pozycja 0,00 zł z kanału' }];
  return finalize(lines, 'refused', `Stawka ${g.vat}% miałaby na paragonie wartość 0,00 zł, bo gratis jest w niej sam. eparagony odrzuca taki paragon kodem 41 i nic nie trafia do drukarki. OpenLinker nie wysyła go wcale i czeka na formę gratisu.`);
}

/* ── Rounding remainder (D-01, G-17) ──────────────────────────────── */

export const ROUNDING_PAID = VARIANTS.mug.price + VARIANTS.coffee.price + 1;

function roundingLines(onGift: boolean): DocLine[] {
  return [
    { name: VARIANTS.mug.name, qty: 1, unitGross: VARIANTS.mug.price + (onGift ? 0 : 1), gross: VARIANTS.mug.price + (onGift ? 0 : 1), vat: 23, kind: 'goods', note: onGift ? undefined : '+0,01 zł reszty z zaokrąglenia' },
    { name: VARIANTS.coffee.name, qty: 1, unitGross: VARIANTS.coffee.price, gross: VARIANTS.coffee.price, vat: 5, kind: 'goods' },
    { name: `${VARIANTS.spoon.name} (gratis)`, qty: 1, unitGross: onGift ? 1 : 0, gross: onGift ? 1 : 0, vat: 23, kind: 'gift', note: onGift ? 'reszta 0,01 zł trafiła na gratis' : undefined },
  ];
}

export const roundingBefore = (): DocResult => finalize(roundingLines(true), 'ready');
/** After: the remainder sits on the largest paid line and the gift stays at 0,00 zł in the mug's 23% rate. */
export const roundingAfter = (): DocResult => finalize(roundingLines(false), 'ready');

/* ── Whole-order discount (D-03): spread automatically, never held ── */

export const DISCOUNT = 1000;
export const DISCOUNT_PAID = VARIANTS.mug.price + VARIANTS.coffee.price - DISCOUNT;

/** Proportional to line value, exact to the grosz; the remainder goes to the largest paid line. */
export interface DiscountLine { name: string; before: number; rebate: number; after: number; vat: number }

/** The automatic split: proportional to line value, exact to the grosz, remainder to the largest paid line. */
export function proportionalRebates(): number[] {
  const items = [VARIANTS.mug, VARIANTS.coffee];
  const total = items.reduce((a, v) => a + v.price, 0);
  const floors = items.map((v) => Math.floor((DISCOUNT * v.price) / total));
  let rest = DISCOUNT - floors.reduce((a, b) => a + b, 0);
  const order = items.map((v, i) => ({ i, price: v.price })).sort((a, b) => b.price - a.price);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i] += 1;
    rest -= 1;
  }
  return floors;
}

/** Applies a split of the whole-order discount (automatic by default, or the operator's override). */
export function allocateDiscount(rebates: number[] = proportionalRebates()): { doc: DocResult; perLine: DiscountLine[] } {
  const items = [VARIANTS.mug, VARIANTS.coffee];
  const floors = rebates;
  const perLine = items.map((v, i) => ({ name: v.name, before: v.price, rebate: floors[i], after: v.price - floors[i], vat: v.vat }));
  const lines: DocLine[] = perLine.map((p) => ({ name: p.name, qty: 1, unitGross: p.after, gross: p.after, vat: p.vat, kind: 'goods', note: `rabat zamówienia -${(p.rebate / 100).toFixed(2).replace('.', ',')} zł` }));
  return { doc: finalize(lines, 'ready'), perLine };
}

/* ── Bundle split (B-14) ──────────────────────────────────────────── */

export function bundleSplit(key: 'morning' | 'brew') {
  const b = BUNDLES[key];
  return splitBundlePrice(b.price, latest(b)).map((s) => ({ ...s, name: VARIANTS[s.variant].name, gift: s.share === 0 }));
}

export function splitMissingDoc(): DocResult {
  const lines: DocLine[] = [{ name: 'Zestaw degustacyjny', qty: 1, unitGross: 8900, gross: 8900, vat: 23, kind: 'bundle' }];
  return finalize(lines, 'held', 'Ustawienie każe pokazać zestaw jako składniki, ale "Miarka do kawy" nie jest sprzedawana osobno i nie ma kosztu zakupu. Bez tego nie da się podzielić ceny zestawu. Dokument czeka na cenę albo koszt składnika.');
}

export const SPLIT_MISSING_ROWS = [
  { name: VARIANTS.coffee.name, qty: 1, standalone: VARIANTS.coffee.price as number | null, vat: 5 },
  { name: VARIANTS.tea.name, qty: 1, standalone: VARIANTS.tea.price as number | null, vat: 5 },
  { name: 'Miarka do kawy', qty: 1, standalone: null as number | null, vat: 23 },
];

/* ── EUR on Erli (X-08) ───────────────────────────────────────────── */

export const EUR_ORDER = {
  number: 'ERLI-DE-55120',
  market: 'de',
  currency: 'EUR',
  lines: [
    { name: VARIANTS.coffee.name, qty: 2, unitGross: 899, taxRate: 'TAX_7', rate: 7 },
    { name: VARIANTS.mug.name, qty: 1, unitGross: 1099, taxRate: 'TAX_19', rate: 19 },
  ],
};

export const providerName = (p: DocProvider): string => DOC_PROVIDERS[p].name;
