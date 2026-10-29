/**
 * Buyer Emails Config
 *
 * Per-connection opt-in for transactional emails sent to the buyer (#3554, epic
 * #3510 D6). Read from `Connection.config.buyerEmails` (JSONB, no schema change)
 * and OFF by default: an absent or unreadable key means no buyer email is ever
 * sent for the connection, so an upgrade sends nothing new.
 *
 * Pure helpers (no I/O), the `readStockSafetyBuffer` config-coercion precedent.
 * The template vocabulary is closed and carries no marketing member, so "no
 * marketing email" is structural rather than a runtime check.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

export const BUYER_EMAILS_CONFIG_KEY = 'buyerEmails';

export const BuyerEmailTemplateValues = [
  'order-confirmed',
  'shipped',
  'document-issued',
  'return-received',
] as const;
export type BuyerEmailTemplate = (typeof BuyerEmailTemplateValues)[number];

/** Templates a marketplace connection may enable; order confirmation is the shop's own. */
export const MarketplaceBuyerEmailTemplateValues = [
  'shipped',
  'document-issued',
  'return-received',
] as const satisfies readonly BuyerEmailTemplate[];

export interface BuyerEmailTemplateConfig {
  enabled: boolean;
  fromAddress?: string;
  replyTo?: string;
}

export interface BuyerEmailsConfig {
  enabled: boolean;
  templates: Partial<Record<BuyerEmailTemplate, BuyerEmailTemplateConfig>>;
}

export function isBuyerEmailTemplate(value: unknown): value is BuyerEmailTemplate {
  return (
    typeof value === 'string' && (BuyerEmailTemplateValues as readonly string[]).includes(value)
  );
}

/** A single bare address: no whitespace, no CR/LF, no list or display-name syntax (header injection). */
export function isSingleEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce `config.buyerEmails` defensively. Anything but an explicit
 * `enabled: true` reads as off; an unknown template key or a malformed sender
 * is dropped rather than honoured.
 */
export function readBuyerEmailsConfig(
  config: ConnectionConfig | null | undefined
): BuyerEmailsConfig {
  const off: BuyerEmailsConfig = { enabled: false, templates: {} };
  const raw = config?.[BUYER_EMAILS_CONFIG_KEY];
  if (!isRecord(raw) || raw.enabled !== true) {
    return off;
  }
  const templates: BuyerEmailsConfig['templates'] = {};
  if (isRecord(raw.templates)) {
    for (const [key, value] of Object.entries(raw.templates)) {
      if (!isBuyerEmailTemplate(key) || !isRecord(value)) {
        continue;
      }
      templates[key] = {
        enabled: value.enabled === true,
        ...(isSingleEmailAddress(value.fromAddress) ? { fromAddress: value.fromAddress } : {}),
        ...(isSingleEmailAddress(value.replyTo) ? { replyTo: value.replyTo } : {}),
      };
    }
  }
  return { enabled: true, templates };
}
