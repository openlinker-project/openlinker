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

export const RELEASE_STEPS: readonly ReleaseStepEntry[] = [
  {
    id: 'shipping-routing',
    scope: 'connection',
    introducedIn: '0.20.0',
    // Required only while a channel still has carrier-named delivery methods
    // going through the shop: without a decision the behaviour after the update
    // may differ from what the operator expects.
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
