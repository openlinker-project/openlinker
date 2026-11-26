/**
 * InPost Connection-Config Contribution (#4134)
 *
 * The non-render half of the "Marketplace shipment notification" setting:
 * `config.shipping.notifyMarketplaceOnLabelPurchase`, which core reads through
 * `readNotifyOnLabelPurchase` (default off). Before this it was reachable only
 * by hand-editing the raw Config JSON.
 *
 * The form field is a tri-state string so "never chosen" survives the round
 * trip: `''` leaves the key absent, `'true'` / `'false'` write that boolean.
 * Turning the box off after it was on therefore stores an explicit `false`
 * (the #2610 rule), while an untouched connection keeps no key at all.
 * Sibling keys inside `shipping` and unknown raw-JSON keys are preserved.
 *
 * @module plugins/inpost
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.shipping.notifyMarketplaceOnLabelPurchase`: '' = never chosen. */
    inpostNotifyOnLabelPurchase?: '' | 'true' | 'false';
  }
}

const NAMESPACE = 'shipping';
const KEY = 'notifyMarketplaceOnLabelPurchase';

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const inpostSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  inpostNotifyOnLabelPurchase: z.enum(['', 'true', 'false']).optional(),
};

function readShippingBag(config: Record<string, unknown>): Record<string, unknown> {
  const raw = config[NAMESPACE];
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export const inpostConnectionConfig: ConnectionConfigContribution = {
  schemaShape: inpostSchemaShape,
  readConfigToForm: (config) => {
    const value = readShippingBag(config)[KEY];
    return { inpostNotifyOnLabelPurchase: value === true ? 'true' : value === false ? 'false' : '' };
  },
  applyToConfig: (config, patch) => {
    const chosen = patch.inpostNotifyOnLabelPurchase;
    if (chosen !== 'true' && chosen !== 'false') {
      return { ...config };
    }
    return { ...config, [NAMESPACE]: { ...readShippingBag(config), [KEY]: chosen === 'true' } };
  },
};
