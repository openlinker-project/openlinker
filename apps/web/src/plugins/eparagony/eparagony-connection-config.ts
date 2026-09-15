/**
 * eparagony.pl Connection-Config Contribution (#3266)
 *
 * The non-render half of eparagony.pl's structured connection-config editing,
 * plugged into `EditConnectionForm` via `PlatformContribution.connectionConfig`.
 * Before this, the plugin declared no contribution at all and every config key
 * beyond the wizard's `environment` / `posId` was reachable only by hand-editing
 * the raw Config JSON textarea.
 *
 *   - `schemaShape` - the Zod fragment merged into the edit-connection schema.
 *     Deliberately no stricter than `EparagonyConnectionConfigShapeValidatorAdapter`
 *     (#2240): that validator puts no length bound on `paymentName` or
 *     `fiscalDeviceUniqueNumber` and no upper bound on `statusPollTimeoutMs`, so
 *     neither does this. A form that refuses what the backend accepts is worse
 *     than one that lets the backend answer.
 *   - `readConfigToForm` - hydration, every leaf falling back to `''`.
 *   - `applyToConfig` - per-keystroke partial-patch assembly. Touches only the
 *     keys present on the patch, so untouched siblings and the operator's own
 *     unknown raw-JSON keys survive.
 *
 * `taxRates` is deliberately absent - see the plan's §3.5. It is the seller's
 * physical device programming rather than a product's VAT rate, and stays on the
 * raw JSON editor.
 *
 * The `declare module` block merges the field names into
 * `PluginEditConnectionFields` so `form.register('eparagonyPrint')` etc. stay
 * statically typed in `eparagony-structured-section.tsx`. It enters the TS
 * import graph through `plugins/eparagony/index.ts` -> `plugins/index.ts`.
 *
 * @module plugins/eparagony
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readConfigString, readOptionalConfigString } from '../../shared/plugins';
import {
  EPARAGONY_PAYMENT_FORM_VALUES,
  EPARAGONY_PRINT_STATES,
  EPARAGONY_TAX_RATE_CODE_VALUES,
} from './eparagony-config.constants';

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /**
     * `config.print` as a THREE-state form value: `''` (absent), `'true'`,
     * `'false'`. Three rather than a checkbox's two because #2610's rule
     * applies - an explicit operator choice and an unset knob are different
     * persisted states that must round-trip apart.
     */
    eparagonyPrint?: string;
    /** `config.paymentForm` - the vendor's closed 10-value vocabulary. */
    eparagonyPaymentForm?: string;
    /** `config.paymentName` - free text, descriptive only. */
    eparagonyPaymentName?: string;
    /** `config.defaultTaxRateCode` - a device slot letter A-G. See the hazard infotip. */
    eparagonyDefaultTaxRateCode?: string;
    /** `config.statusPollTimeoutMs`, entered as a string and parsed at assembly. */
    eparagonyStatusPollTimeoutMs?: string;
    /** `config.fiscalDeviceUniqueNumber` - diagnostic only, never sent on a document. */
    eparagonyFiscalDeviceUniqueNumber?: string;
    /** `config.apiBaseUrl` - testing override. */
    eparagonyApiBaseUrl?: string;
    /** `config.authBaseUrl` - testing override. */
    eparagonyAuthBaseUrl?: string;
  }
}

/**
 * Trim-and-bound a free-text leaf with NO maximum, matching the backend.
 *
 * Written as a helper rather than inlined so the "no max here, on purpose"
 * decision has one place to be read and reversed.
 */
const unboundedText = z.union([z.string().trim(), z.literal('')]).optional();

// The explicit annotation keeps TS's excess-property check live (the KSeF
// precedent): an un-annotated const referenced at `schemaShape:` would silently
// accept a key that was never declaration-merged, producing an untyped
// `register()` path.
const eparagonySchemaShape: ConnectionConfigContribution['schemaShape'] = {
  eparagonyPrint: z.enum(EPARAGONY_PRINT_STATES).optional(),
  eparagonyPaymentForm: z
    .union([z.enum(EPARAGONY_PAYMENT_FORM_VALUES), z.literal('')])
    .optional(),
  eparagonyPaymentName: unboundedText,
  eparagonyDefaultTaxRateCode: z
    .union([z.enum(EPARAGONY_TAX_RATE_CODE_VALUES), z.literal('')])
    .optional(),
  // Positive whole milliseconds, mirroring the backend's "positive number" rule.
  // No UPPER bound: the adapter clamps to 5-90 s rather than rejecting, so a
  // form maximum would refuse a value the backend accepts and would describe a
  // clamp as a validation error.
  eparagonyStatusPollTimeoutMs: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d+$/, 'Poll timeout must be a whole number of milliseconds.')
        .refine((value) => Number.parseInt(value, 10) > 0, {
          message: 'Poll timeout must be greater than zero.',
        }),
      z.literal(''),
    ])
    .optional(),
  eparagonyFiscalDeviceUniqueNumber: unboundedText,
  eparagonyApiBaseUrl: httpsUrlField(),
  eparagonyAuthBaseUrl: httpsUrlField(),
};

/**
 * An https-only URL, or empty.
 *
 * Mirrors the backend's `validateUrl`: parseable, and `https:`. Checked here
 * too because these two fields are the only ones an operator can get wrong in a
 * way that silently points a fiscal connection at another host - worth an inline
 * message rather than a round-trip 400.
 */
function httpsUrlField(): z.ZodTypeAny {
  return z
    .union([
      z
        .string()
        .trim()
        .refine((value) => value === '' || isHttpsUrl(value), {
          message: 'Must be a valid https:// URL.',
        }),
      z.literal(''),
    ])
    .optional();
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Read `config.print` back as a form state.
 *
 * Both `false` and absent are legitimate and distinct: `false` is an operator
 * who decided, absent is one who never looked. A non-boolean value (a hand-typed
 * `"yes"` in the raw editor) reads as absent rather than being coerced - the
 * backend will reject it on save, and silently showing it as one of the two real
 * states would hide that.
 */
function readPrint(config: Record<string, unknown>): string {
  if (config.print === true) return 'true';
  if (config.print === false) return 'false';
  return '';
}

/** Read a numeric leaf back as the form's string shape; anything else reads as ''. */
function readNumberAsString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * Read a closed-vocabulary leaf, narrowing to `''` when the stored value is not
 * one this build recognises - so an unknown value shows as unset rather than
 * being pre-selected into a `<select>` that cannot render it.
 */
function readEnum(
  config: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string {
  const value = config[key];
  return typeof value === 'string' && values.includes(value) ? value : '';
}

/** Set a trimmed string leaf, or delete the key when the operator cleared it. */
function applyTextLeaf(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  formField: string,
  configKey: string,
): void {
  const raw = readOptionalConfigString(patch, formField);
  if (raw === undefined) return;
  const trimmed = raw.trim();
  if (trimmed.length === 0) delete target[configKey];
  else target[configKey] = trimmed;
}

/**
 * Merge a PARTIAL eparagony structured patch into the config.
 *
 * Every clause is guarded on the field being PRESENT on the patch, which is what
 * makes per-keystroke single-field patching safe: a patch carrying only
 * `eparagonyPrint` must not disturb `paymentForm`, and must not disturb an
 * unknown key the operator added by hand in the raw editor either. The spread
 * preserves those; the guards preserve the siblings.
 */
function applyEparagonyConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const print = readOptionalConfigString(patch, 'eparagonyPrint');
  if (print !== undefined) {
    if (print === 'true') next.print = true;
    else if (print === 'false') next.print = false;
    else delete next.print;
  }

  const paymentForm = readOptionalConfigString(patch, 'eparagonyPaymentForm');
  if (paymentForm !== undefined) {
    if (paymentForm.length === 0) delete next.paymentForm;
    else next.paymentForm = paymentForm;
  }

  const defaultTaxRateCode = readOptionalConfigString(patch, 'eparagonyDefaultTaxRateCode');
  if (defaultTaxRateCode !== undefined) {
    if (defaultTaxRateCode.length === 0) delete next.defaultTaxRateCode;
    else next.defaultTaxRateCode = defaultTaxRateCode;
  }

  const pollTimeout = readOptionalConfigString(patch, 'eparagonyStatusPollTimeoutMs');
  if (pollTimeout !== undefined) {
    const trimmed = pollTimeout.trim();
    const parsed = Number.parseInt(trimmed, 10);
    // A half-typed value (`''`, or a stray `-`) deletes rather than writing
    // `NaN`: the schema reports the error, and the config must stay a shape the
    // backend would accept if the operator saved mid-edit.
    if (trimmed.length === 0 || !Number.isFinite(parsed)) delete next.statusPollTimeoutMs;
    else next.statusPollTimeoutMs = parsed;
  }

  applyTextLeaf(next, patch, 'eparagonyPaymentName', 'paymentName');
  applyTextLeaf(next, patch, 'eparagonyFiscalDeviceUniqueNumber', 'fiscalDeviceUniqueNumber');
  applyTextLeaf(next, patch, 'eparagonyApiBaseUrl', 'apiBaseUrl');
  applyTextLeaf(next, patch, 'eparagonyAuthBaseUrl', 'authBaseUrl');

  return next;
}

export const eparagonyConnectionConfig: ConnectionConfigContribution = {
  schemaShape: eparagonySchemaShape,
  readConfigToForm: (config) => ({
    eparagonyPrint: readPrint(config),
    eparagonyPaymentForm: readEnum(config, 'paymentForm', EPARAGONY_PAYMENT_FORM_VALUES),
    eparagonyPaymentName: readConfigString(config, 'paymentName'),
    eparagonyDefaultTaxRateCode: readEnum(
      config,
      'defaultTaxRateCode',
      EPARAGONY_TAX_RATE_CODE_VALUES,
    ),
    eparagonyStatusPollTimeoutMs: readNumberAsString(config, 'statusPollTimeoutMs'),
    eparagonyFiscalDeviceUniqueNumber: readConfigString(config, 'fiscalDeviceUniqueNumber'),
    eparagonyApiBaseUrl: readConfigString(config, 'apiBaseUrl'),
    eparagonyAuthBaseUrl: readConfigString(config, 'authBaseUrl'),
  }),
  applyToConfig: applyEparagonyConfig,
};
