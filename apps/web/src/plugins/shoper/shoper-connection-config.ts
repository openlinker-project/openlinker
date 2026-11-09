/**
 * Shoper Connection-Config Contribution (#3702)
 *
 * The non-render half of Shoper's structured connection-config editing: the
 * three fallback ids `config.defaults.{shippingId,paymentId,statusId}` a Shoper
 * order needs when no operator mapping resolves one, plus the three ids the
 * lifecycle writeback uses (`parcelShippingId`, `cancelledStatusId`,
 * `inProgressStatusId`). Before this they were reachable only by hand-editing
 * the raw Config JSON.
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
import { getShoperMessages } from './messages';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /** `config.defaults.shippingId`, entered as a string and parsed at assembly. */
    shoperShippingId?: string;
    /** `config.defaults.paymentId`. */
    shoperPaymentId?: string;
    /** `config.defaults.statusId`. */
    shoperStatusId?: string;
    /** `config.defaults.parcelShippingId`. */
    shoperParcelShippingId?: string;
    /** `config.defaults.cancelledStatusId`. */
    shoperCancelledStatusId?: string;
    /** `config.defaults.inProgressStatusId`. */
    shoperInProgressStatusId?: string;
  }
}

/** Form field -> `config.defaults` key. One table so read, write and schema cannot drift. */
export const SHOPER_DEFAULT_FIELDS = [
  { field: 'shoperShippingId', key: 'shippingId' },
  { field: 'shoperPaymentId', key: 'paymentId' },
  { field: 'shoperStatusId', key: 'statusId' },
  { field: 'shoperParcelShippingId', key: 'parcelShippingId' },
  { field: 'shoperCancelledStatusId', key: 'cancelledStatusId' },
  { field: 'shoperInProgressStatusId', key: 'inProgressStatusId' },
] as const;

type ShoperDefaultField = (typeof SHOPER_DEFAULT_FIELDS)[number]['field'];

function positiveIntegerField(field: ShoperDefaultField): z.ZodTypeAny {
  return z
    .union([
      // The message is looked up when a value is validated, so it follows
      // the active language instead of freezing at module load.
      z.string().refine((value) => value === '' || /^[1-9]\d*$/.test(value.trim()), {
        error: () => getShoperMessages().shoperConnectionConfig.positiveInteger[field],
      }),
      z.literal(''),
    ])
    .optional();
}

// Annotated so TS keeps the excess-property check live (the KSeF precedent).
const shoperSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  shoperShippingId: positiveIntegerField('shoperShippingId'),
  shoperPaymentId: positiveIntegerField('shoperPaymentId'),
  shoperStatusId: positiveIntegerField('shoperStatusId'),
  shoperParcelShippingId: positiveIntegerField('shoperParcelShippingId'),
  shoperCancelledStatusId: positiveIntegerField('shoperCancelledStatusId'),
  shoperInProgressStatusId: positiveIntegerField('shoperInProgressStatusId'),
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
    return Object.fromEntries(SHOPER_DEFAULT_FIELDS.map(({ field, key }) => [field, read(key)]));
  },
  applyToConfig: applyShoperConfig,
};
