/**
 * Buyer Emails Config Helpers (#3555)
 *
 * Pure reads and writes over the two places #3554 keeps buyer-email state:
 * the connection's `config.buyerEmails` (opt-in, per-template switch, sender)
 * and the seeded automation rule per template (subject, body). Mirrors the
 * backend's `readBuyerEmailsConfig` and channel rule so the page offers only
 * what the server would accept.
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import type {
  AutomationRule,
  AutomationRuleWriteInput,
  AutomationTrigger,
} from '../../automation';
import {
  BUYER_EMAIL_TEMPLATE_VALUES,
  MARKETPLACE_BUYER_EMAIL_TEMPLATES,
  isBuyerEmailTemplate,
  type BuyerEmailTemplate,
  type BuyerEmailTemplateSettings,
  type BuyerEmailsSettings,
} from '../api/buyer-emails.types';

/** The automation trigger each template's seeded rule fires on. */
export const BUYER_EMAIL_TEMPLATE_TRIGGER = {
  'order-confirmed': 'order.received',
  shipped: 'order.shipped',
  'document-issued': 'order.document_issued',
  'return-received': 'return.received',
} as const satisfies Record<BuyerEmailTemplate, AutomationTrigger>;

/** A single bare address - the backend's own check (no whitespace, no list, no display name). */
export function isSingleEmailAddress(value: string): boolean {
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Anything but an explicit `enabled: true` reads as off, as on the server. */
export function readBuyerEmailsSettings(config: Record<string, unknown>): BuyerEmailsSettings {
  const raw = config.buyerEmails;
  const templates: BuyerEmailsSettings['templates'] = {};
  if (isRecord(raw) && isRecord(raw.templates)) {
    for (const [key, value] of Object.entries(raw.templates)) {
      if (!isBuyerEmailTemplate(key) || !isRecord(value)) continue;
      templates[key] = {
        enabled: value.enabled === true,
        ...(typeof value.fromAddress === 'string' ? { fromAddress: value.fromAddress } : {}),
        ...(typeof value.replyTo === 'string' ? { replyTo: value.replyTo } : {}),
      };
    }
  }
  return { enabled: isRecord(raw) && raw.enabled === true, templates };
}

/** The connection config with `buyerEmails` replaced; every other key untouched. */
export function withBuyerEmailsSettings(
  config: Record<string, unknown>,
  settings: BuyerEmailsSettings,
): Record<string, unknown> {
  return { ...config, buyerEmails: settings };
}

export function withTemplateSettings(
  settings: BuyerEmailsSettings,
  template: BuyerEmailTemplate,
  next: BuyerEmailTemplateSettings,
): BuyerEmailsSettings {
  const cleaned: BuyerEmailTemplateSettings = {
    enabled: next.enabled,
    ...(next.fromAddress?.trim() ? { fromAddress: next.fromAddress.trim() } : {}),
    ...(next.replyTo?.trim() ? { replyTo: next.replyTo.trim() } : {}),
  };
  return { ...settings, templates: { ...settings.templates, [template]: cleaned } };
}

export type BuyerEmailChannelKind = 'marketplace' | 'shop';

/** `OfferManager` without `ProductMaster` is a marketplace - the server's rule, never `platformType`. */
export function channelKindOf(enabledCapabilities: readonly string[]): BuyerEmailChannelKind {
  return enabledCapabilities.includes('OfferManager') && !enabledCapabilities.includes('ProductMaster')
    ? 'marketplace'
    : 'shop';
}

export function isTemplateAllowed(
  template: BuyerEmailTemplate,
  kind: BuyerEmailChannelKind,
): boolean {
  return kind === 'shop' || MARKETPLACE_BUYER_EMAIL_TEMPLATES.includes(template);
}

export function templatesFor(kind: BuyerEmailChannelKind): readonly BuyerEmailTemplate[] {
  return BUYER_EMAIL_TEMPLATE_VALUES.filter((template) => isTemplateAllowed(template, kind));
}

/** The `send-email` step of a buyer-email rule, if the rule is one. */
function buyerEmailStep(rule: AutomationRule): Record<string, unknown> | null {
  const step = rule.actions.find(
    (action) => isRecord(action) && action.action === 'send-email' && 'buyerEmailTemplate' in action,
  );
  return isRecord(step) ? step : null;
}

/** The seeded rule carrying this template's wording, found by its step - never by a fixed id. */
export function findTemplateRule(
  rules: readonly AutomationRule[],
  template: BuyerEmailTemplate,
): AutomationRule | null {
  return rules.find((rule) => buyerEmailStep(rule)?.buyerEmailTemplate === template) ?? null;
}

export function readRuleWording(rule: AutomationRule): { subject: string; body: string } {
  const step = buyerEmailStep(rule);
  return {
    subject: typeof step?.subject === 'string' ? step.subject : '',
    body: typeof step?.body === 'string' ? step.body : '',
  };
}

/**
 * The rule's full replace with new wording. The step keeps every other field
 * (recipient, template marker) verbatim; `isActive` is set by the caller.
 */
export function withRuleWording(
  rule: AutomationRule,
  wording: { subject: string; body: string },
  isActive: boolean,
): AutomationRuleWriteInput {
  return {
    name: rule.name,
    trigger: rule.trigger,
    triggerConfig: rule.triggerConfig,
    conditions: rule.conditions,
    actions: rule.actions.map((action) =>
      isRecord(action) && action.action === 'send-email' && 'buyerEmailTemplate' in action
        ? { ...action, subject: wording.subject, body: wording.body }
        : action,
    ),
    isActive,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  };
}

/** The merge fields the editor offers, all resolvable by the automation renderer. */
export const BUYER_EMAIL_MERGE_FIELDS = [
  'order.reference',
  'order.total',
  'order.placedAt',
  'buyer.name',
  'shipment.tracking',
] as const;

/** The editor's preview: each field replaced with a sample value. */
export function renderPreview(text: string): string {
  const samples: Record<string, string> = {
    'order.reference': 'SHOP-4821',
    'order.total': '249.00 PLN',
    'order.placedAt': '2026-10-29',
    'buyer.name': 'Anna Kowalska',
    'shipment.tracking': '0000123456789',
  };
  return text.replace(/\{([a-zA-Z.]+)\}/g, (match, field: string) => samples[field] ?? match);
}
