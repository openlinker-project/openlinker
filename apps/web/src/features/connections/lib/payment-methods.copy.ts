/**
 * Copy for the payment-method mapping section (#3775).
 *
 * Worded from the operator's side: they know their shop's payment modules by
 * name and what each one means, not how an order is classified internally.
 * Lives in a `*.copy.ts` so `check-ui-vocabulary` can scan it.
 *
 * @module features/connections/lib
 */
import type { PaymentMethodChoice } from './payment-method-map';

export const PAYMENT_METHODS_COPY = {
  heading: 'Payment methods',
  intro:
    'Tell OpenLinker what each of your payment modules means, so an order paid with it is not left as "unknown". Changes apply to orders received after you save.',
  codNote: 'Cash on delivery also fills in the order total as the amount the courier collects.',
  loading: 'Reading the payment modules your recent orders used...',
  readFailed:
    'We could not read your recent payment modules. Your saved mapping is unchanged. Try again in a moment.',
  unsupported: 'This integration does not use a payment mapping, so there is nothing to set here.',
  unreachable:
    'We could not reach this connection just now, so modules the shop already defines cannot be marked. Your mapping can still be edited.',
  empty: (days: number): string =>
    `No orders with a payment module in the last ${days} days yet. Modules appear here once orders arrive.`,
  notSeen: (days: number): string => `Not seen in the last ${days} days`,
  platformDefined: (method: string): string => `Defined by the shop: ${method}`,
  ordersCount: (count: number): string => `${count} ${count === 1 ? 'order' : 'orders'}`,
  lastSeen: 'last seen',
  selectLabel: (gateway: string): string => `What ${gateway} means`,
  notSet: 'Not set',
} as const;

export const PAYMENT_METHOD_LABELS: Record<Exclude<PaymentMethodChoice, ''>, string> = {
  online: 'Online',
  bank_transfer: 'Bank transfer',
  cash_on_delivery: 'Cash on delivery',
};
