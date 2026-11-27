/**
 * Buyer Data Retention Config (#4289)
 *
 * `Connection.config.buyerDataRetention`: a connection's own override of the
 * global retention defaults held in Operational Settings. Each field is
 * optional and an absent field (or an absent / `null` key) means "inherit the
 * global value", so a connection that never set it is untouched.
 *
 * The reader coerces and ignores what it does not recognise (the
 * `readStockSafetyBuffer` precedent): a stored value must never break a sweep.
 * The validator is the strict half, for the write path, where there is an
 * operator to tell.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import {
  BUYER_DATA_ERASE_MODES,
  BUYER_DATA_PERIOD_MAX_DAYS,
  BUYER_DATA_PERIOD_MIN_DAYS,
  isBuyerDataEraseMode,
  isBuyerDataPeriodOrderValid,
  isValidBuyerDataPeriod,
  type BuyerDataEraseMode,
  type BuyerDataRetentionRule,
} from '@openlinker/core/operational-settings';

/** The raw per-connection override as it sits in `Connection.config`. */
export interface BuyerDataRetentionOverride {
  readonly enabled?: boolean;
  readonly hideAfterDays?: number;
  readonly eraseAfterDays?: number;
  readonly mode?: BuyerDataEraseMode;
}

export function readBuyerDataRetentionConfig(
  config: Record<string, unknown> | null | undefined
): BuyerDataRetentionOverride {
  const raw = config?.buyerDataRetention;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  return {
    ...(typeof record.enabled === 'boolean' && { enabled: record.enabled }),
    ...(isValidBuyerDataPeriod(record.hideAfterDays) && { hideAfterDays: record.hideAfterDays }),
    ...(isValidBuyerDataPeriod(record.eraseAfterDays) && {
      eraseAfterDays: record.eraseAfterDays,
    }),
    ...(isBuyerDataEraseMode(record.mode) && { mode: record.mode }),
  };
}

/** A connection's own fields win; the global default fills the rest. */
export function resolveEffectiveBuyerDataRule(
  global: BuyerDataRetentionRule,
  override: BuyerDataRetentionOverride
): BuyerDataRetentionRule {
  return {
    enabled: override.enabled ?? global.enabled,
    hideAfterDays: override.hideAfterDays ?? global.hideAfterDays,
    eraseAfterDays: override.eraseAfterDays ?? global.eraseAfterDays,
    mode: override.mode ?? global.mode,
  };
}

/** What the write path refuses, in the terms `connectionConfigInvalid` needs. */
export interface BuyerDataRetentionConfigIssue {
  readonly field: string;
  readonly rule: 'object' | 'boolean' | 'range' | 'one-of';
  readonly message: string;
  readonly bounds?: Record<string, string | number>;
}

export function findBuyerDataRetentionConfigIssue(
  config: Record<string, unknown> | null | undefined
): BuyerDataRetentionConfigIssue | null {
  const raw = config?.buyerDataRetention;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      field: 'config.buyerDataRetention',
      rule: 'object',
      message: 'config.buyerDataRetention must be an object',
    };
  }
  const record = raw as Record<string, unknown>;
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    return {
      field: 'config.buyerDataRetention.enabled',
      rule: 'boolean',
      message: 'config.buyerDataRetention.enabled must be a boolean',
    };
  }
  for (const key of ['hideAfterDays', 'eraseAfterDays'] as const) {
    if (record[key] !== undefined && !isValidBuyerDataPeriod(record[key])) {
      return {
        field: `config.buyerDataRetention.${key}`,
        rule: 'range',
        message: `config.buyerDataRetention.${key} must be 0 (never) or a whole number of days between ${String(BUYER_DATA_PERIOD_MIN_DAYS)} and ${String(BUYER_DATA_PERIOD_MAX_DAYS)}`,
        bounds: { min: BUYER_DATA_PERIOD_MIN_DAYS, max: BUYER_DATA_PERIOD_MAX_DAYS },
      };
    }
  }
  if (record.mode !== undefined && !isBuyerDataEraseMode(record.mode)) {
    return {
      field: 'config.buyerDataRetention.mode',
      rule: 'one-of',
      message: `config.buyerDataRetention.mode must be ${BUYER_DATA_ERASE_MODES.join(' or ')}`,
      bounds: { allowed: BUYER_DATA_ERASE_MODES.join(', ') },
    };
  }
  const hide = record.hideAfterDays;
  const erase = record.eraseAfterDays;
  if (
    typeof hide === 'number' &&
    typeof erase === 'number' &&
    !isBuyerDataPeriodOrderValid(hide, erase)
  ) {
    return {
      field: 'config.buyerDataRetention.eraseAfterDays',
      rule: 'range',
      message: 'config.buyerDataRetention.eraseAfterDays must not be shorter than hideAfterDays',
      bounds: { min: hide },
    };
  }
  return null;
}
