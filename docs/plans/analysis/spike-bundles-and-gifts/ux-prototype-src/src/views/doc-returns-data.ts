/**
 * Mock returns for the Zwroty screen. Amounts in PLN grosze; bundle values come
 * from the split frozen at sale (calc.splitBundlePrice), never from today's prices.
 */
import { BUNDLES, VARIANTS, type GiftSource } from '../model/catalog';
import { buildDocument, splitBundlePrice, type DocLine } from '../model/calc';
import { finalize } from './doc-data';

export type Custody = 'announced' | 'received' | 'restocked' | 'blocked' | 'kept' | 'manual' | 'review';
export type MoneyState = 'pending' | 'proposed' | 'refunded' | 'none';

export interface RetLine {
  id: string;
  name: string;
  sku: string;
  role?: 'bundle' | 'gift' | 'component';
  partOf?: string;
  giftSource?: GiftSource;
  advised: number;
  received: number;
  restocked: number;
  reason: string;
  custody: Custody;
  money: MoneyState;
  orderLine: string | null;
  orderLineNote?: string;
}

export const CUSTODY_LABEL: Record<Custody, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'review' }> = {
  announced: { label: 'Zgłoszony przez kanał', tone: 'neutral' },
  received: { label: 'Przyjęty w magazynie', tone: 'info' },
  restocked: { label: 'Przyjęty na stan', tone: 'success' },
  blocked: { label: 'Przyjęcie na stan wstrzymane', tone: 'warning' },
  kept: { label: 'Zostaje u klienta', tone: 'neutral' },
  manual: { label: 'Do decyzji', tone: 'review' },
  review: { label: 'Do sprawdzenia', tone: 'warning' },
};

export const MONEY_LABEL: Record<MoneyState, { label: string; tone: 'neutral' | 'info' | 'success' | 'review' }> = {
  pending: { label: 'Kwota do ustalenia', tone: 'review' },
  proposed: { label: 'Propozycja gotowa', tone: 'info' },
  refunded: { label: 'Zwrócono', tone: 'success' },
  none: { label: 'Bez zwrotu', tone: 'neutral' },
};

/* Morning set sold under the frozen split: mug 34,66 zł, coffee 30,33 zł, spoon gift 0,00 zł. */
export const MORNING_SPLIT = splitBundlePrice(BUNDLES.morning.price, BUNDLES.morning.versions[1].components);
export const shareOf = (variant: string): number => MORNING_SPLIT.find((s) => s.variant === variant)?.share ?? 0;
export const LOST_DISCOUNT = VARIANTS.mug.price - shareOf('mug');

export const ORDER_ALLEGRO = 'Allegro 8812-4410-0921';
export const BUNDLE_LINE_ID = 'li-77d1';

export function originalInvoice() {
  return buildDocument({
    paidLines: [{ name: 'Zestaw poranny', qty: 1, unitGross: BUNDLES.morning.price, vat: 23, bundle: 'morning' }],
    giftTreatment: 'omit',
    bundleMode: 'components',
    refusesZeroRate: false,
  });
}

export function correctionInvoice() {
  const coffee = shareOf('coffee');
  const lines: DocLine[] = [
    { name: `${VARIANTS.coffee.name} (zwrot)`, qty: -1, unitGross: coffee, gross: -coffee, vat: 5, kind: 'component', note: 'część: Zestaw poranny, wartość z zamrożonego podziału' },
  ];
  return finalize(lines, 'ready');
}

/** Gift scenario order: French press + 2 mugs on Allegro, coffee sample from the 150 zł promotion. */
export const GIFT_ORDER = {
  number: 'Allegro 8812-5530-1187',
  press: VARIANTS.press.price,
  mugs: VARIANTS.mug.price * 2,
  threshold: 15000,
  sample: VARIANTS.sample,
};
