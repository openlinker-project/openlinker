/**
 * Shoper Connection-Config Contribution (#3702)
 *
 * The non-render half of Shoper's structured connection-config editing: the
 * three fallback ids `config.defaults.{shippingId,paymentId,statusId}` a Shoper
 * order needs when no operator mapping resolves one. Before this they were
 * reachable only by hand-editing the raw Config JSON.
 *
 *   - `schemaShape` - a positive-integer string, or `''` for "not set". No
 *     stricter than `ShoperConnectionConfigShapeValidatorAdapter`, which
 *     requires a positive integer when the key is present.
 *   - `readConfigToForm` - hydration, every leaf falling back to `''`.
 *   - `applyToConfig` - per-keystroke partial patch. Touches only the keys on
 *     the patch, so untouched siblings and unknown raw-JSON keys survive.
 *
 * CLEARING WRITES THE EMPTY OBJECT'S KEY AWAY, NOT THE `defaults` KEY: the host
 * submit merges `{ ...fresh.config, ...input.config }` shallowly, so a deleted
 * TOP-LEVEL key is restored from the refetch. `defaults` therefore stays
 * present (as `null` once nothing is set - the validator and `readDefaults`
 * both treat `null` like absent), while an unset leaf inside it is simply
 * omitted, which the shallow merge cannot undo because the whole object is
 * replaced.
 *
 * @module plugins/shoper
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readConfigString, readOptionalConfigString } from '../../shared/plugins';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.defaults.shippingId`, entered as a string and parsed at assembly. */
    shoperShippingId?: string;
    /** `config.defaults.paymentId`. */
    shoperPaymentId?: string;
    /** `config.defaults.statusId`. */
    shoperStatusId?: string;
  }
}

/** Form field -> `config.defaults` key. One table so read, write and schema cannot drift. */
export const SHOPER_DEFAULT_FIELDS = [
  { field: 'shoperShippingId', key: 'shippingId', label: 'delivery method' },
  { field: 'shoperPaymentId', key: 'paymentId', label: 'payment method' },
  { field: 'shoperStatusId', key: 'statusId', label: 'order status' },
] as const;

function positiveIntegerField(label: string): z.ZodTypeAny {
  return z
    .union([
      z.string().refine((value) => value === '' || /^[1-9]\d*$/.test(value.trim()), {
        message: `The ${label} must be a positive whole number.`,
      }),
      z.literal(''),
    ])
    .optional();
}

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const shoperSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  shoperShippingId: positiveIntegerField('delivery method id'),
  shoperPaymentId: positiveIntegerField('payment method id'),
  shoperStatusId: positiveIntegerField('order status id'),
};

function readDefaultsBag(config: Record<string, unknown>): Record<string, unknown> {
  const raw = config.defaults;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function applyShoperConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const touched = SHOPER_DEFAULT_FIELDS.filter(
    ({ field }) => readOptionalConfigString(patch, field) !== undefined,
  );
  if (touched.length === 0) {
    return { ...config };
  }
  const defaults: Record<string, unknown> = { ...readDefaultsBag(config) };
  for (const { field, key } of touched) {
    const raw = (readOptionalConfigString(patch, field) ?? '').trim();
    if (/^[1-9]\d*$/.test(raw)) {
      defaults[key] = Number.parseInt(raw, 10);
    } else {
      delete defaults[key];
    }
  }
  return { ...config, defaults: Object.keys(defaults).length === 0 ? null : defaults };
}

export const shoperConnectionConfig: ConnectionConfigContribution = {
  schemaShape: shoperSchemaShape,
  readConfigToForm: (config) => {
    const defaults = readDefaultsBag(config);
    const read = (key: string): string => {
      const value = defaults[key];
      return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? String(value)
        : readConfigString(defaults, key);
    };
    return {
      shoperShippingId: read('shippingId'),
      shoperPaymentId: read('paymentId'),
      shoperStatusId: read('statusId'),
    };
  },
  applyToConfig: applyShoperConfig,
};
