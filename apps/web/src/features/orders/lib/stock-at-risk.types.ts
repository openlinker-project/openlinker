/**
 * Stock-at-risk types (#2350)
 *
 * The copy and formatters the stock-at-risk builders read, kept apart from
 * the builders in `stock-at-risk.ts`.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, PluralFn, ResolvedCopy } from '../../../shared/i18n';

/** The copy and formatters the builders read, in one language. */
export interface StockAtRiskText {
  copy: ResolvedCopy<Messages['orders']>['stockAtRisk'];
  plural: PluralFn;
  number: (value: number) => string;
}
