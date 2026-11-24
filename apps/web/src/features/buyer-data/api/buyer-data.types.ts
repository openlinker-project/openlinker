/**
 * Buyer Data Retention Types (#4289)
 *
 * Browser-side mirror of the retention contract: a global default
 * (`operational_settings`) plus an optional per-connection override
 * (`Connection.config.buyerDataRetention`). `apps/web` must not import
 * `@openlinker/core` (#591), so the shapes are restated here.
 *
 * Periods are whole DAYS and `0` means "never" (that rule is off).
 *
 * @module apps/web/src/features/buyer-data/api
 */

export const BUYER_DATA_ERASE_MODES = ['personal-data', 'whole-order'] as const;

export type BuyerDataEraseMode = (typeof BUYER_DATA_ERASE_MODES)[number];

export function isBuyerDataEraseMode(value: unknown): value is BuyerDataEraseMode {
  return BUYER_DATA_ERASE_MODES.some((mode) => mode === value);
}

/** The rules that apply to one connection once override and default are resolved. */
export interface BuyerDataRules {
  enabled: boolean;
  /** Days after the order date when it leaves the default lists. `0` = never. */
  hideAfterDays: number;
  /** Days after the order date when buyer personal data is erased. `0` = never. */
  eraseAfterDays: number;
  mode: BuyerDataEraseMode;
}

/** A connection's own rules. An absent field inherits the global value. */
export type BuyerDataOverride = Partial<BuyerDataRules>;

export interface BuyerDataPreviewInput {
  /** Count only this connection's orders; absent counts every connection. */
  connectionId?: string;
  hideAfterDays: number;
  eraseAfterDays: number;
  mode: BuyerDataEraseMode;
}

export interface BuyerDataPreviewSample {
  orderRef: string;
  placedAt: string;
  maskedBuyer: string;
}

export interface BuyerDataPreview {
  toHide: number;
  toErase: number;
  total: number;
  skippedProtected: number;
  samples: BuyerDataPreviewSample[];
}

/** What the new-connection wizard keeps in its form state. */
export type BuyerDataWizardChoice = 'inherit' | 'own';

export interface BuyerDataWizardValue {
  choice: BuyerDataWizardChoice;
  rules: BuyerDataRules | null;
}
