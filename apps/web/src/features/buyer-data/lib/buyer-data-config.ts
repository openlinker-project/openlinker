/**
 * Buyer Data Config Helpers (#4289)
 *
 * Pure reads and writes over the two places buyer-data rules live: the global
 * default and a connection's `config.buyerDataRetention`. An absent or `null`
 * key means the connection inherits the global rules; a present key overrides
 * only the fields it carries.
 *
 * Also the browser mirror of the server's period rule: whole days, `0` for
 * never, otherwise 30 to 3650, and an erase period may not be shorter than the
 * hide period when both are set.
 *
 * @module apps/web/src/features/buyer-data/lib
 */
import {
  isBuyerDataEraseMode,
  type BuyerDataEraseMode,
  type BuyerDataOverride,
  type BuyerDataRules,
  type BuyerDataWizardValue,
} from '../api/buyer-data.types';

export const BUYER_DATA_CONFIG_KEY = 'buyerDataRetention';
export const BUYER_DATA_MIN_DAYS = 30;
export const BUYER_DATA_MAX_DAYS = 3650;

/** The code every refusal carries, so a surface chooses its own words. */
export type BuyerDataRuleIssue = 'hide-range' | 'erase-range' | 'erase-before-hide';

/** The built-in rules a deployment has before anyone sets anything. */
export const BUYER_DATA_DEFAULT_RULES: BuyerDataRules = {
  enabled: false,
  hideAfterDays: 0,
  eraseAfterDays: 0,
  mode: 'personal-data',
};

export const HIDE_PRESET_DAYS: readonly number[] = [0, 30, 60, 90, 180, 365];
export const ERASE_PRESET_DAYS: readonly number[] = [0, 90, 180, 365, 730, 1095, 1825];

export function isValidPeriodDays(days: number): boolean {
  return (
    Number.isInteger(days) &&
    (days === 0 || (days >= BUYER_DATA_MIN_DAYS && days <= BUYER_DATA_MAX_DAYS))
  );
}

export function validateBuyerDataRules(
  rules: Pick<BuyerDataRules, 'hideAfterDays' | 'eraseAfterDays'>
): BuyerDataRuleIssue[] {
  const issues: BuyerDataRuleIssue[] = [];
  if (!isValidPeriodDays(rules.hideAfterDays)) issues.push('hide-range');
  if (!isValidPeriodDays(rules.eraseAfterDays)) issues.push('erase-range');
  if (
    isValidPeriodDays(rules.hideAfterDays) &&
    isValidPeriodDays(rules.eraseAfterDays) &&
    rules.hideAfterDays > 0 &&
    rules.eraseAfterDays > 0 &&
    rules.eraseAfterDays < rules.hideAfterDays
  ) {
    issues.push('erase-before-hide');
  }
  return issues;
}

export type PeriodUnit = 'days' | 'months' | 'years';

const DAYS_PER_UNIT: Record<PeriodUnit, number> = { days: 1, months: 30, years: 365 };

export function periodToDays(amount: number, unit: PeriodUnit): number {
  return Math.round(amount * DAYS_PER_UNIT[unit]);
}

/** The largest unit that divides the period exactly, so 365 reads as one year. */
export function daysToPeriod(days: number): { amount: number; unit: PeriodUnit } {
  if (days >= 365 && days % 365 === 0) return { amount: days / 365, unit: 'years' };
  if (days >= 30 && days % 30 === 0 && days < 365) return { amount: days / 30, unit: 'months' };
  return { amount: days, unit: 'days' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `null` is "inherit everything"; an object keeps only the fields it states validly. */
export function readBuyerDataSettings(
  config: Record<string, unknown> | null | undefined
): BuyerDataOverride | null {
  const raw = config?.[BUYER_DATA_CONFIG_KEY];
  if (!isRecord(raw)) return null;
  const out: BuyerDataOverride = {};
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.hideAfterDays === 'number') out.hideAfterDays = raw.hideAfterDays;
  if (typeof raw.eraseAfterDays === 'number') out.eraseAfterDays = raw.eraseAfterDays;
  if (isBuyerDataEraseMode(raw.mode)) out.mode = raw.mode;
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * The connection config with `buyerDataRetention` replaced; every other key is
 * untouched. Inherit is an EXPLICIT `null` rather than a deleted key: the edit
 * form merges over a fresh copy with a shallow spread, which a missing key
 * could not override (the rate-limit rule, #2016).
 */
export function withBuyerDataSettings(
  config: Record<string, unknown>,
  settings: BuyerDataOverride | null
): Record<string, unknown> {
  return { ...config, [BUYER_DATA_CONFIG_KEY]: settings };
}

/** The effective rules: the override's field when present, else the global one. */
export function resolveBuyerDataRules(
  override: BuyerDataOverride | null,
  global: BuyerDataRules
): BuyerDataRules {
  return {
    enabled: override?.enabled ?? global.enabled,
    hideAfterDays: override?.hideAfterDays ?? global.hideAfterDays,
    eraseAfterDays: override?.eraseAfterDays ?? global.eraseAfterDays,
    mode: override?.mode ?? global.mode,
  };
}

/** A full set of rules written as the connection's own, ready to store. */
export function overrideFromRules(rules: BuyerDataRules): BuyerDataOverride {
  return {
    enabled: rules.enabled,
    hideAfterDays: rules.hideAfterDays,
    eraseAfterDays: rules.eraseAfterDays,
    mode: rules.mode,
  };
}

export function withMode(rules: BuyerDataRules, mode: BuyerDataEraseMode): BuyerDataRules {
  return { ...rules, mode };
}

/** The global rules as the settings endpoint reports them; built-in defaults where it omits a field. */
export function globalRulesFromSettings(
  view:
    | {
        buyerDataRetentionEnabled?: { value: boolean };
        buyerDataHideAfterDays?: { value: number };
        buyerDataEraseAfterDays?: { value: number };
        buyerDataEraseMode?: { value: BuyerDataEraseMode };
      }
    | null
    | undefined
): BuyerDataRules {
  return {
    enabled: view?.buyerDataRetentionEnabled?.value ?? BUYER_DATA_DEFAULT_RULES.enabled,
    hideAfterDays: view?.buyerDataHideAfterDays?.value ?? BUYER_DATA_DEFAULT_RULES.hideAfterDays,
    eraseAfterDays: view?.buyerDataEraseAfterDays?.value ?? BUYER_DATA_DEFAULT_RULES.eraseAfterDays,
    mode: view?.buyerDataEraseMode?.value ?? BUYER_DATA_DEFAULT_RULES.mode,
  };
}

export const DEFAULT_BUYER_DATA_WIZARD_VALUE: BuyerDataWizardValue = {
  choice: 'inherit',
  rules: null,
};

/**
 * The config entry a new connection is created with. "General settings" adds
 * NOTHING - the key stays absent, so the connection follows whatever the general
 * rules become; own rules are stored switched off.
 */
export function wizardBuyerDataConfig(
  value: BuyerDataWizardValue | undefined
): { buyerDataRetention: BuyerDataOverride } | Record<string, never> {
  if (value === undefined || value.choice !== 'own' || value.rules === null) return {};
  return { buyerDataRetention: overrideFromRules({ ...value.rules, enabled: false }) };
}
