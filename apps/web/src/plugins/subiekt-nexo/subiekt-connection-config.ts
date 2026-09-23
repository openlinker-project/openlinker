/**
 * Subiekt Connection-Config Contribution (#1324, on the #1330 seam)
 *
 * The non-render half of Subiekt's per-invoice payment structured-config
 * editing, plugged into `EditConnectionForm` via
 * `PlatformContribution.connectionConfig` (the same seam KSeF uses). Owns the
 * three #1324 fields — payment method, bank account, cash register (Stanowisko
 * Kasowe) — so they are assembled by the plugin rather than growing the host
 * `edit-connection.schema.ts` (PR review IMPORTANT #1):
 *
 *   - `schemaShape` — the Zod field fragment merged into the edit-connection
 *     schema when a Subiekt connection is edited.
 *   - `readConfigToForm` — hydration from flat `config.{defaultPaymentMethod,
 *     bankAccountId,defaultStanowiskoKasoweId}`. Payment method is tri-state:
 *     an absent key hydrates to `''` (unset — send-nothing, the bridge keeps
 *     its own default), NOT a forced `'cash'` (review IMPORTANT #2).
 *   - `applyToConfig` — per-keystroke partial-patch assembly: flat scalars with
 *     delete-on-empty; the two id fields parse to the bridge-native `number`.
 *
 * The `declare module` block merges the three field names into
 * `PluginEditConnectionFields` so `form.watch('subiektNexoPaymentMethod')` etc.
 * stay statically typed in `subiekt-structured-section.tsx`. It enters the TS
 * import graph through `plugins/subiekt/index.ts` → `plugins/index.ts`.
 *
 * The pre-existing Subiekt fields (`subiektNexoBridgeUrl`, `subiektNexoTriggerModel`,
 * `subiektCapabilities`) remain host-inlined for now — their #1330 migration is
 * out of scope for #1324.
 *
 * @module plugins/subiekt-nexo
 */
import { z } from 'zod';
import type { ConnectionConfigContribution } from '../../shared/plugins';
import { readOptionalConfigString } from '../../shared/plugins';

// WHY THE FORM FIELDS SAY `subiektNexo*` WHILE THE STORED KEYS DO NOT.
//
// `PluginEditConnectionFields` is one declaration-merged interface shared by
// every plugin, so two plugins cannot contribute the same field name -
// `assert-unique-plugin-invariants` refuses it at import time. Subiekt GT and
// Subiekt nexo are separate plugins built from the same original code, so
// their form fields had to be told apart.
//
// The PERSISTED keys are deliberately NOT renamed. They are a different thing:
// the form field `subiektNexoPaymentMethod` reads and writes
// `config.defaultPaymentMethod`, exactly as it always did. Renaming those
// would orphan the configuration of every connection that already exists,
// which is a data migration rather than a form change - and it would buy
// nothing, since `config` is per connection and cannot collide across plugins.

declare module '../../shared/plugins/plugin.types' {
  interface PluginEditConnectionFields {
    /**
     * #1324 — Subiekt payment method → flat `config.defaultPaymentMethod`
     * (`'cash' | 'transfer'`). Tri-state: empty string means unset
     * (send-nothing; the bridge keeps its own default).
     */
    subiektNexoPaymentMethod?: string;
    /**
     * #1324 — Subiekt bank account → flat `config.bankAccountId` (bridge-native
     * int). Form holds a string; parsed to a number at serialize, key deleted
     * when empty.
     */
    subiektNexoBankAccountId?: string;
    /**
     * #1324 — Subiekt cash register (Stanowisko Kasowe) → flat
     * `config.defaultStanowiskoKasoweId` (bridge-native int). Form holds a
     * string; parsed to a number at serialize, deleted when empty. No Oddział
     * counterpart — that axis is session-bound and not selectable (decision 8b).
     */
    subiektNexoStanowiskoKasoweId?: string;
  }
}

// The explicit annotation keeps TS's excess-property check live on this
// separate const (mirrors the KSeF precedent) so a typo'd or never-merged key
// is a compile error at the contribution literal.
const subiektSchemaShape: ConnectionConfigContribution['schemaShape'] = {
  // Tri-state: empty allowed for unset (send-nothing). The bridge only sends a
  // payment method when one is explicitly configured.
  subiektNexoPaymentMethod: z.union([z.enum(['cash', 'transfer']), z.literal('')]).optional(),
  subiektNexoBankAccountId: z.string().optional(),
  subiektNexoStanowiskoKasoweId: z.string().optional(),
};

/** Read the tri-state Subiekt payment method out of `config.defaultPaymentMethod`. */
function readSubiektPaymentMethod(config: Record<string, unknown>): string {
  return config.defaultPaymentMethod === 'cash' || config.defaultPaymentMethod === 'transfer'
    ? config.defaultPaymentMethod
    : '';
}

/** Read a bridge-native numeric id leaf back as the form's string shape (`''` when absent). */
function readNumericIdAsString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'number' ? String(value) : '';
}

/**
 * Merge a PARTIAL Subiekt structured patch into the config — the write side.
 * All three fields are flat with delete-on-empty; the two id fields parse to
 * the bridge-native `number`. Only leaves present on the patch are touched, so
 * per-keystroke single-field patches never drop sibling keys.
 */
function applySubiektConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  const paymentMethod = readOptionalConfigString(patch, 'subiektNexoPaymentMethod');
  if (paymentMethod !== undefined) {
    if (paymentMethod.length === 0) delete next.defaultPaymentMethod;
    else next.defaultPaymentMethod = paymentMethod;
  }
  const bankAccountId = readOptionalConfigString(patch, 'subiektNexoBankAccountId');
  if (bankAccountId !== undefined) {
    if (bankAccountId.length === 0) delete next.bankAccountId;
    else next.bankAccountId = Number(bankAccountId);
  }
  const stanowiskoKasoweId = readOptionalConfigString(patch, 'subiektNexoStanowiskoKasoweId');
  if (stanowiskoKasoweId !== undefined) {
    if (stanowiskoKasoweId.length === 0) delete next.defaultStanowiskoKasoweId;
    else next.defaultStanowiskoKasoweId = Number(stanowiskoKasoweId);
  }
  return next;
}

export const subiektConnectionConfig: ConnectionConfigContribution = {
  schemaShape: subiektSchemaShape,
  readConfigToForm: (config) => ({
    subiektNexoPaymentMethod: readSubiektPaymentMethod(config),
    subiektNexoBankAccountId: readNumericIdAsString(config, 'bankAccountId'),
    subiektNexoStanowiskoKasoweId: readNumericIdAsString(config, 'defaultStanowiskoKasoweId'),
  }),
  applyToConfig: applySubiektConfig,
};
