/**
 * Pure rules behind every number in the prototype. Amounts are grosze.
 * These mirror the spike's decisions (Q11 split, D3 ATP, gift document forms).
 */
import { BUNDLES, VARIANTS, type Bundle, type BundleComponent, type GiftDocTreatment, type VatRate } from './catalog';

/** Bundle availability = min over components of floor((stock - held) / qty). Unknown if any component is stale. */
export function bundleAtp(components: BundleComponent[]): { atp: number | null; limiting: string | null; perComponent: { variant: string; available: number; qty: number; sets: number }[] } {
  const per = components.map((c) => {
    const v = VARIANTS[c.variant];
    const available = Math.max(0, v.stock - v.held);
    return { variant: c.variant, available, qty: c.qty, sets: Math.floor(available / c.qty), stale: v.stale === true };
  });
  if (per.some((p) => p.stale)) return { atp: null, limiting: null, perComponent: per };
  let min = Infinity;
  let limiting: string | null = null;
  for (const p of per) {
    if (p.sets < min) {
      min = p.sets;
      limiting = p.variant;
    }
  }
  return { atp: per.length ? min : 0, limiting, perComponent: per };
}

export interface SplitLine {
  variant: string;
  qty: number;
  standalone: number;
  share: number;
  vat: VatRate;
  overStandalone: boolean;
}

/**
 * Split a bundle price proportionally to each component's standalone price x qty,
 * largest remainder in grosze so the parts always sum to the bundle price.
 * Gift slots get 0.
 */
export function splitBundlePrice(price: number, components: BundleComponent[]): SplitLine[] {
  const paid = components.filter((c) => !c.gift);
  const weights = paid.map((c) => VARIANTS[c.variant].price * c.qty);
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total ? (price * w) / total : 0));
  const floors = raw.map(Math.floor);
  let rest = price - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i] += 1;
    rest -= 1;
  }
  let k = 0;
  return components.map((c) => {
    const v = VARIANTS[c.variant];
    const share = c.gift ? 0 : floors[k++];
    return { variant: c.variant, qty: c.qty, standalone: v.price * c.qty, share, vat: v.vat, overStandalone: share > v.price * c.qty };
  });
}

export function latest(bundle: Bundle): BundleComponent[] {
  return bundle.versions[bundle.versions.length - 1].components;
}

export function bundleCost(components: BundleComponent[]): number | null {
  let sum = 0;
  for (const c of components) {
    const cost = VARIANTS[c.variant].cost;
    if (cost === null) return null;
    sum += cost * c.qty;
  }
  return sum;
}

export function mixedVat(components: BundleComponent[]): boolean {
  return new Set(components.filter((c) => !c.gift).map((c) => VARIANTS[c.variant].vat)).size > 1;
}

export const vatOfGross = (gross: number, rate: number): number => Math.round((gross * rate) / (100 + rate));

/* ── Sales documents ────────────────────────────────────────────────── */

export interface DocLine {
  name: string;
  qty: number;
  unitGross: number;
  gross: number;
  vat: number;
  note?: string;
  kind: 'goods' | 'bundle' | 'component' | 'gift' | 'service' | 'rebate';
}

export interface DocResult {
  status: 'ready' | 'held' | 'refused';
  reason?: string;
  lines: DocLine[];
  total: number;
  perRate: { rate: number; gross: number; vat: number }[];
  internalRecord?: { name: string; qty: number; costNet: number; vat: number };
}

export interface DocInput {
  paidLines: { name: string; qty: number; unitGross: number; vat: number; bundle?: keyof typeof BUNDLES }[];
  gift?: { variant: string; qty: number };
  giftTreatment: GiftDocTreatment;
  bundleMode: 'one-line' | 'components';
  /** Device refuses a VAT rate whose value is <= 0 (eparagony errorCode 41). */
  refusesZeroRate: boolean;
}

function perRate(lines: DocLine[]): DocResult['perRate'] {
  const m = new Map<number, number>();
  for (const l of lines) if (l.kind !== 'rebate') m.set(l.vat, (m.get(l.vat) ?? 0) + l.gross);
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([rate, gross]) => ({ rate, gross, vat: vatOfGross(gross, rate) }));
}

export function buildDocument(input: DocInput): DocResult {
  const lines: DocLine[] = [];
  for (const p of input.paidLines) {
    if (p.bundle && input.bundleMode === 'components') {
      const comps = latest(BUNDLES[p.bundle]);
      for (const s of splitBundlePrice(p.unitGross, comps)) {
        if (s.share === 0) continue;
        const v = VARIANTS[s.variant];
        lines.push({ name: v.name, qty: p.qty * s.qty, unitGross: Math.round(s.share / s.qty), gross: s.share * p.qty, vat: s.vat, kind: 'component', note: `część: ${BUNDLES[p.bundle].name}` });
      }
    } else {
      lines.push({ name: p.name, qty: p.qty, unitGross: p.unitGross, gross: p.unitGross * p.qty, vat: p.vat, kind: p.bundle ? 'bundle' : 'goods' });
    }
  }
  let internalRecord: DocResult['internalRecord'];
  let status: DocResult['status'] = 'ready';
  let reason: string | undefined;
  if (input.gift) {
    const g = VARIANTS[input.gift.variant];
    const sameRate = lines.some((l) => l.vat === g.vat && l.gross > 0);
    switch (input.giftTreatment) {
      case 'omit':
        if (!sameRate) {
          status = 'held';
          reason = `Gratis ma stawkę ${g.vat}%, a żadna płatna pozycja nie ma tej stawki. Pominięcie zmieniłoby stawkę podatku. Wybierz formę gratisu w ustawieniach dokumentów.`;
        }
        break;
      case 'hold':
        status = 'held';
        reason = 'Forma gratisu na dokumencie nie jest ustawiona. Dokument czeka na decyzję.';
        break;
      case 'grosz':
        lines.push({ name: `${g.name} (gratis)`, qty: input.gift.qty, unitGross: 1, gross: input.gift.qty, vat: g.vat, kind: 'gift', note: 'cena symboliczna 0,01 zł' });
        break;
      case 'priced-in': {
        // Move a proportional share of the paid total onto the gift, capped at its own price.
        const total = lines.reduce((a, l) => a + l.gross, 0);
        const giftWeight = g.price * input.gift.qty;
        const share = Math.min(giftWeight, Math.round((total * giftWeight) / (total + giftWeight)));
        let left = share;
        for (let i = lines.length - 1; i >= 0 && left > 0; i -= 1) {
          const take = Math.min(left, lines[i].gross - 1);
          lines[i] = { ...lines[i], gross: lines[i].gross - take, unitGross: Math.round((lines[i].gross - take) / lines[i].qty) };
          left -= take;
        }
        lines.push({ name: `${g.name} (gratis w cenie zestawu)`, qty: input.gift.qty, unitGross: Math.round(share / input.gift.qty), gross: share, vat: g.vat, kind: 'gift', note: 'udział w zapłaconej kwocie' });
        break;
      }
      case 'internal-record':
        internalRecord = { name: g.name, qty: input.gift.qty, costNet: (g.cost ?? 0) * input.gift.qty, vat: g.vat };
        break;
    }
  }
  const rates = perRate(lines);
  if (status === 'ready' && input.refusesZeroRate && rates.some((r) => r.gross <= 0)) {
    status = 'refused';
    reason = 'Kasa odrzuci paragon: stawka VAT po rabatach ma wartość 0 (eparagony, kod 41).';
  }
  return { status, reason, lines, total: lines.reduce((a, l) => a + l.gross, 0), perRate: rates, internalRecord };
}

/* ── Gift economics ─────────────────────────────────────────────────── */

export function giftCost(variant: string, qty: number): number | null {
  const c = VARIANTS[variant].cost;
  return c === null ? null : c * qty;
}

export const SMALL_GIFT_UNIT_LIMIT = 2000; // 20 zł net purchase cost per unit, art. 7 ust. 4 pkt 2 (PL pack)
export const SMALL_GIFT_YEAR_LIMIT = 10000; // 100 zł per person per year with a register (PL pack)
