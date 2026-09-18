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
 *     `fiscalDeviceUniqueNumber`, no upper bound on `statusPollTimeoutMs`, and
 *     accepts any positive finite number there rather than an integer - so
 *     neither does this. A form that refuses what the backend accepts is worse
 *     than one that lets the backend answer.
 *   - `readConfigToForm` - hydration, every leaf falling back to `''`.
 *   - `applyToConfig` - per-keystroke partial-patch assembly. Touches only the
 *     keys present on the patch, so untouched siblings and the operator's own
 *     unknown raw-JSON keys survive.
 *
 * CLEARING A FIELD WRITES AN EXPLICIT `null`, NEVER A DELETE (#3268 review).
 * `EditConnectionForm.onSubmit` refetches the connection immediately before
 * saving and merges `{ ...fresh.config, ...input.config }`. A shallow spread can
 * only override a key PRESENT on the right side, so a deleted key is restored
 * from that refetch and the clear silently does not persist - `true -> unset`
 * reads back as `true`. That is the same failure the `rateLimit` (#2016),
 * `stockPolicy` and `pricingRule` (#2610) clauses in `edit-connection.schema.ts`
 * already write `null` to avoid, and it matters most on `defaultTaxRateCode`,
 * whose own copy tells the operator to leave it empty. `null` is safe on every
 * one of the eight keys: the backend validator guards each with
 * `=== undefined || === null`, and every reader treats `null` exactly like
 * absent (see `eparagony-config.types.ts`, where the eight are typed `| null`
 * for that reason).
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
} from './eparagony-config.types';

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
 * Trim a free-text leaf with NO maximum, matching the backend.
 *
 * `z.string().trim()` already accepts `''`, so there is deliberately no
 * `z.literal('')` arm here - unlike the two enum fields below, where the empty
 * string is not a member of the vocabulary and the arm IS load-bearing.
 *
 * Written as a helper rather than inlined so the "no max here, on purpose"
 * decision has one place to be read and reversed.
 */
const unboundedText = z.string().trim().optional();

// The explicit annotation keeps TS's excess-property check live (the KSeF
// precedent): an un-annotated const referenced at `schemaShape:` would silently
// accept a key that was never declaration-merged, producing an untyped
// `register()` path.
const eparagonySchemaShape: ConnectionConfigContribution['schemaShape'] = {
  eparagonyPrint: z.enum(EPARAGONY_PRINT_STATES).optional(),
  eparagonyPaymentForm: z.union([z.enum(EPARAGONY_PAYMENT_FORM_VALUES), z.literal('')]).optional(),
  eparagonyPaymentName: unboundedText,
  eparagonyDefaultTaxRateCode: z
    .union([z.enum(EPARAGONY_TAX_RATE_CODE_VALUES), z.literal('')])
    .optional(),
  // A positive number of milliseconds, mirroring the backend's "positive finite
  // number" rule and nothing more.
  //
  // No UPPER bound: the adapter clamps to 5-90 s rather than rejecting, so a
  // form maximum would refuse a value the backend accepts and would describe a
  // clamp as a validation error.
  //
  // A DECIMAL is accepted for a less obvious reason (#3268 review). The
  // validator's rule is `typeof === 'number' && isFinite && > 0`, so
  // `statusPollTimeoutMs: 1000.5` is a legal PERSISTED value, and this resolver
  // is form-wide: an integer-only rule would let one such stored value block
  // every other edit on the connection - a rename, a rate limit, a payment form
  // - until the operator retyped a field they may never have set. That is a
  // mirror stricter than the gate with page-wide blast radius.
  //
  // Exponent notation is accepted for the same reason. `readNumberAsString`
  // renders a stored value with `String(value)`, and JS renders a legally
  // finite number like 1e-7 or 1e+21 that way - a plain `\d+(\.\d+)?` refused
  // that rendering while the validator would accept the underlying number,
  // one notation short of the trap this comment already describes.
  eparagonyStatusPollTimeoutMs: z
    .union([
      z
        .string()
        .trim()
        .regex(
          /^\d+(\.\d+)?(e[+-]?\d+)?$/i,
          'Poll timeout must be a number of milliseconds.',
        )
        .refine((value) => Number(value) > 0, {
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
    .string()
    .trim()
    .refine((value) => value === '' || isHttpsUrl(value), {
      message: 'Must be a valid https:// URL.',
    })
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
 *
 * Narrowing alone would still RENDER an unrecognised value as a known one (the
 * "use the default" option), which is rule 1 of the style guide's unknown-value
 * section: never render an unrecognised value as a known one.
 * `readUnrecognisedEnumValue` below is the other half - the section surfaces the
 * stored value in the field's description so the operator can find and remove
 * it, rather than getting a 400 naming a key the form shows as unset.
 */
function readEnum(config: Record<string, unknown>, key: string, values: readonly string[]): string {
  const value = config[key];
  return typeof value === 'string' && values.includes(value) ? value : '';
}

/**
 * The stored value of a closed-vocabulary leaf when this build does not
 * recognise it, or `null` when there is nothing to report.
 *
 * `null` (the cleared state this file writes) and absent are both "nothing
 * stored", never "an unrecognised value" - reporting them would put a warning on
 * every unset field.
 *
 * KNOWN LIMITATION (#3268 review, tracked as #3311): an unrecognised value hydrates the RHF
 * field - and hence the controlled `<select>` - to `''`, which is also the
 * value of the recommended "Not set" option. Clicking that already-selected
 * option therefore fires no `onChange` (neither the DOM nor React consider it
 * a change), so `configText` keeps carrying the stale unrecognised value and
 * a save fails identically. The warning itself does not disappear - it is
 * reactively derived from `configText`, so an attentive operator gets a clue
 * that nothing changed. The section's warning copy now says so explicitly
 * (pick a DIFFERENT option first, then switch back if the default was
 * intended), rather than instructing "pick one below" unqualified - the
 * copy-only fix a reviewer flagged. Picking any OTHER option still clears it
 * correctly, since that is a genuine value change. Not fixed at the
 * mechanism level: a real fix would mean detecting this case and forcing a
 * write regardless of the select's rendered state, which is a behaviour
 * change rather than the read-side fix this function makes.
 */
export function readUnrecognisedEnumValue(
  config: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string | null {
  const value = config[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && values.includes(value)) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * The stored value of `print` when this build does not recognise it, or
 * `null` when there is nothing to report.
 *
 * A dedicated function rather than a `readUnrecognisedEnumValue` call: that
 * one's vocabulary is a `readonly string[]`, but `print`'s two legal values
 * are booleans, not strings - the same "not a string enum" reason `readPrint`
 * is its own function rather than a `readEnum` call. `print` is otherwise the
 * exact same hazard as `paymentForm` / `defaultTaxRateCode`: the backend
 * validator rejects a non-boolean `print` (`must be a boolean`) precisely like
 * it rejects an unrecognised enum value, so a hand-typed `"yes"` in the raw
 * editor deserves the identical treatment - reported in the field's own
 * description, never silently narrowed to "unset" with no explanation
 * (#3268 review).
 */
export function readUnrecognisedPrintValue(config: Record<string, unknown>): string | null {
  const value = config.print;
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Set a trimmed string leaf, or write an explicit `null` when the operator
 * cleared it.
 *
 * `null` rather than `delete` for the pre-submit-merge reason in this file's
 * header: a deleted key is restored from `onSubmit`'s refetch, so the clear
 * would never reach the server.
 */
function applyTextLeaf(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  formField: string,
  configKey: string,
): void {
  const raw = readOptionalConfigString(patch, formField);
  if (raw === undefined) return;
  const trimmed = raw.trim();
  target[configKey] = trimmed.length === 0 ? null : trimmed;
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
    else next.print = null;
  }

  const paymentForm = readOptionalConfigString(patch, 'eparagonyPaymentForm');
  if (paymentForm !== undefined) {
    next.paymentForm = paymentForm.length === 0 ? null : paymentForm;
  }

  const defaultTaxRateCode = readOptionalConfigString(patch, 'eparagonyDefaultTaxRateCode');
  if (defaultTaxRateCode !== undefined) {
    next.defaultTaxRateCode = defaultTaxRateCode.length === 0 ? null : defaultTaxRateCode;
  }

  const pollTimeout = readOptionalConfigString(patch, 'eparagonyStatusPollTimeoutMs');
  if (pollTimeout !== undefined) {
    const trimmed = pollTimeout.trim();
    // `Number`, not `Number.parseInt`: parseInt reads `'1000.5'` as 1000 and
    // `'12abc'` as 12, so a decimal or half-typed value would be silently
    // TRUNCATED into the config rather than reported. `Number('')` is 0, which
    // the `> 0` test rejects along with `'-5'` - the config must stay a shape
    // the backend would accept if the operator saved mid-edit, and a
    // non-positive value is one the validator refuses.
    const parsed = Number(trimmed);
    const usable = trimmed.length > 0 && Number.isFinite(parsed) && parsed > 0;
    next.statusPollTimeoutMs = usable ? parsed : null;
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
