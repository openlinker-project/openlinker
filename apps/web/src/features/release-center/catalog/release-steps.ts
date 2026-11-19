/**
 * Release step catalog (#4145, ADR-085)
 *
 * The one reviewable list of setup steps a release asks operators for: which
 * exist, since which version, for whom and where they point. Text lives in
 * `locales/{en,pl}/release-center.json` under `steps.<id>.*`, never here.
 * `scripts/check-release-center-catalog.mjs` reads this file textually, so keep
 * each entry's `id`, `introducedIn`, `routePattern` and `target` as plain
 * string literals.
 *
 * @module features/release-center
 */

import type { ReleaseStepEntry } from './release-step.types';

const CONNECTION_UPDATE_KEY = ['connections', 'update'] as const;

function changedConfigKey(variables: unknown, before: unknown, key: string): boolean {
  const next = readConfigValue(variables, key);
  const prev = readConfigValue(before, key);
  return next !== undefined && next !== prev;
}

function readConfigValue(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  const config = (source as { input?: { config?: unknown }; config?: unknown }).input?.config
    ?? (source as { config?: unknown }).config;
  if (typeof config !== 'object' || config === null) return undefined;
  return key.split('.').reduce<unknown>((value, part) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return (value as Record<string, unknown>)[part];
  }, config);
}

const BASE_STEPS: readonly ReleaseStepEntry[] = [
  {
    id: 'shipping-routing',
    scope: 'connection',
    introducedIn: '0.20.0',
    // Required only while a channel still has carrier-named delivery methods
    // going through the shop: without a decision the behaviour after the update
    // may differ from what the operator expects.
    // Follow-up: every caller passes `unassignedCarrierMethods: 0` today, so this
    // reads optional. The count needs the source's delivery methods (a live
    // platform read) plus the routing rules and a definition of "carrier-named";
    // there is no cheap read for it, so it is not issued from the bell.
    importance: (ctx) => (ctx.unassignedCarrierMethods > 0 ? 'required' : 'optional'),
    requires: 'connections:write',
    routePattern: 'connections/:connectionId/mappings',
    routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
    target: 'label-master',
    appliesWhen: (ctx) =>
      ctx.connection !== null && ctx.connection.capabilities.includes('OrderSource'),
    completeOn: {
      mutationKey: ['mappings', 'fulfillment-routing', 'update'],
      when: () => true,
    },
  },
  {
    id: 'packing-owner',
    scope: 'connection',
    introducedIn: '0.20.0',
    importance: () => 'optional',
    requires: 'connections:write',
    routePattern: 'connections/:connectionId/edit',
    routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
    target: 'pack-check',
    appliesWhen: (ctx) =>
      ctx.connection !== null && ctx.connection.capabilities.includes('OrderProcessorManager'),
    completeOn: {
      mutationKey: CONNECTION_UPDATE_KEY,
      when: (variables, before) =>
        changedConfigKey(variables, before, 'fulfilmentOwnedByDestination'),
    },
  },
  {
    id: 'inpost-notify-buyer',
    scope: 'connection',
    introducedIn: '0.20.0',
    importance: () => 'optional',
    requires: 'connections:write',
    routePattern: 'connections/:connectionId/edit',
    routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
    target: 'notify-setting',
    appliesWhen: (ctx) => ctx.connection?.platformType === 'inpost',
    completeOn: {
      mutationKey: CONNECTION_UPDATE_KEY,
      when: (variables, before) =>
        changedConfigKey(variables, before, 'shipping.notifyMarketplaceOnLabelPurchase'),
    },
  },
];

// SIMULATION ONLY (never commit): different steps under older minors.
const edit = (
  id: string, introducedIn: string, target: string, importance: 'required' | 'optional',
  appliesWhen: ReleaseStepEntry['appliesWhen']
): ReleaseStepEntry => ({
  id, scope: 'connection', introducedIn, importance: () => importance, requires: 'connections:write',
  routePattern: 'connections/:connectionId/edit',
  routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
  target, appliesWhen,
  completeOn: { mutationKey: CONNECTION_UPDATE_KEY, when: () => false },
});
export const RELEASE_STEPS: readonly ReleaseStepEntry[] = [
  ...BASE_STEPS,
  edit('sim-rate-limit', '0.18.0', 'sim-rate-limit', 'required', (ctx) => ctx.connection?.platformType === 'allegro'),
  edit('sim-stock-pricing', '0.18.0', 'sim-stock-pricing', 'optional', (ctx) => ctx.connection?.platformType === 'prestashop'),
  edit('sim-payment', '0.19.0', 'sim-payment-writeback', 'optional', (ctx) => ctx.connection?.platformType === 'prestashop'),
  {
    id: 'sim-mappings', scope: 'connection', introducedIn: '0.18.0', importance: () => 'required', requires: 'connections:write',
    routePattern: 'connections/:connectionId/mappings', routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
    target: 'label-master', appliesWhen: (ctx) => ctx.connection?.capabilities.includes('OrderSource') === true,
    completeOn: { mutationKey: ['sim', 'never'], when: () => false },
  },
  edit('sim-pack', '0.19.0', 'pack-check', 'required', (ctx) => ctx.connection?.capabilities.includes('OrderProcessorManager') === true),
  edit('sim-notify', '0.19.0', 'notify-setting', 'optional', (ctx) => ctx.connection?.platformType === 'inpost'),
  edit('sim-woo-stock', '0.15.0', 'sim-stock-pricing', 'optional', (ctx) => ctx.connection?.platformType === 'woocommerce'),
  edit('sim-erli-rate', '0.15.0', 'sim-rate-limit', 'required', (ctx) => ctx.connection?.platformType === 'erli'),
  edit('sim-fulfil', '0.16.0', 'pack-check', 'optional', (ctx) => ctx.connection?.capabilities.includes('OrderProcessorManager') === true),
  edit('sim-sales-doc', '0.16.0', 'sim-sales-documents', 'required', (ctx) => ctx.connection?.capabilities.includes('Invoicing') === true),
  {
    id: 'sim-routing', scope: 'connection', introducedIn: '0.16.0', importance: () => 'optional', requires: 'connections:write',
    routePattern: 'connections/:connectionId/mappings', routeParams: (ctx) => ({ connectionId: ctx.connection?.id ?? '' }),
    target: 'label-master', appliesWhen: (ctx) => ctx.connection?.platformType === 'allegro',
    completeOn: { mutationKey: ['sim', 'never'], when: () => false },
  },
  edit('sim-advanced', '0.17.0', 'sim-advanced', 'optional', () => true),
  edit('sim-inpost-label', '0.17.0', 'sim-label-purchase', 'optional', (ctx) => ctx.connection?.platformType === 'inpost'),
  {
    id: 'sim-who', scope: 'installation', introducedIn: '0.17.0', importance: () => 'required', requires: 'connections:write',
    routePattern: 'settings/who-decides', routeParams: () => ({}), target: 'sim-nowhere',
    appliesWhen: () => true, completeOn: { mutationKey: ['sim', 'never'], when: () => false },
  },
  {
    // Standalone: no `introducedIn`, so it belongs to no release.
    id: 'sim-columns', scope: 'installation', importance: () => 'optional', requires: 'connections:write',
    routePattern: 'orders', routeParams: () => ({}), target: 'orders-columns',
    appliesWhen: () => true, completeOn: { mutationKey: ['sim', 'never'], when: () => false },
  },
  {
    id: 'sim-missing', scope: 'installation', introducedIn: '0.19.0', importance: () => 'optional', requires: 'connections:write',
    routePattern: 'settings/who-decides', routeParams: () => ({}), target: 'sim-nowhere',
    appliesWhen: () => true, completeOn: { mutationKey: ['sim', 'never'], when: () => false },
  },
];
