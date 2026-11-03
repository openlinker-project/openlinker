import { describe, expect, it } from 'vitest';
import type { AutomationRule } from '../../automation';
import {
  BUYER_EMAIL_MERGE_FIELDS,
  channelKindOf,
  findTemplateRule,
  isSingleEmailAddress,
  readBuyerEmailsSettings,
  readRuleWording,
  renderPreview,
  templatesFor,
  withBuyerEmailsSettings,
  withRuleWording,
  withTemplateSettings,
} from './buyer-emails-config';
import { buyerEmailFieldOfServerMessage } from './buyer-email-editor.schema';

function rule(template: string, isActive = false): AutomationRule {
  return {
    id: `rule-${template}`,
    name: `Buyer email: ${template}`,
    trigger: 'order.shipped',
    triggerConfig: {},
    conditions: [],
    actions: [
      {
        action: 'send-email',
        recipient: { kind: 'buyer' },
        subject: 'Hi {order.reference}',
        body: 'Body',
        buyerEmailTemplate: template,
      },
    ],
    definitionHash: 'h',
    isActive,
    effectiveFrom: '2026-10-29',
    effectiveTo: null,
    hasIrreversibleAction: false,
    actionAvailability: [],
    moneyAckByUserId: null,
    moneyAckAt: null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
  };
}

describe('buyer emails config helpers (#3555)', () => {
  it('should read an absent or malformed config as off', () => {
    expect(readBuyerEmailsSettings({})).toEqual({ enabled: false, templates: {} });
    expect(readBuyerEmailsSettings({ buyerEmails: 'yes' })).toEqual({ enabled: false, templates: {} });
  });

  it('should drop an unknown template and keep the rest', () => {
    const settings = readBuyerEmailsSettings({
      buyerEmails: { enabled: true, templates: { marketing: { enabled: true }, shipped: { enabled: true, replyTo: 'a@b.pl' } } },
    });
    expect(settings).toEqual({ enabled: true, templates: { shipped: { enabled: true, replyTo: 'a@b.pl' } } });
  });

  it('should write the settings back without touching other config keys', () => {
    const next = withBuyerEmailsSettings({ baseUrl: 'x' }, { enabled: true, templates: {} });
    expect(next).toEqual({ baseUrl: 'x', buyerEmails: { enabled: true, templates: {} } });
  });

  it('should trim senders and drop empty ones', () => {
    const next = withTemplateSettings({ enabled: true, templates: {} }, 'shipped', {
      enabled: true,
      fromAddress: '  shop@x.pl ',
      replyTo: '   ',
    });
    expect(next.templates.shipped).toEqual({ enabled: true, fromAddress: 'shop@x.pl' });
  });

  it('should read OfferManager without ProductMaster as a marketplace, and hide order-confirmed there', () => {
    expect(channelKindOf(['OfferManager', 'OrderSource'])).toBe('marketplace');
    expect(channelKindOf(['ProductMaster', 'OfferManager', 'OrderSource'])).toBe('shop');
    expect(templatesFor('marketplace')).not.toContain('order-confirmed');
    expect(templatesFor('shop')).toContain('order-confirmed');
  });

  it('should accept one bare address only', () => {
    expect(isSingleEmailAddress('a@b.pl')).toBe(true);
    expect(isSingleEmailAddress('a@b.pl, c@d.pl')).toBe(false);
    expect(isSingleEmailAddress('Shop <a@b.pl>')).toBe(false);
  });

  it('should find the seeded rule by its template marker and replace only its wording', () => {
    const rules = [rule('return-received'), rule('shipped', true)];
    const found = findTemplateRule(rules, 'shipped');
    if (!found) throw new Error('the shipped rule was not found');
    expect(found.id).toBe('rule-shipped');
    expect(readRuleWording(found)).toEqual({ subject: 'Hi {order.reference}', body: 'Body' });

    const write = withRuleWording(found, { subject: 'New', body: 'New body' }, true);
    expect(write.actions[0]).toEqual({
      action: 'send-email',
      recipient: { kind: 'buyer' },
      subject: 'New',
      body: 'New body',
      buyerEmailTemplate: 'shipped',
    });
    expect(write.isActive).toBe(true);
  });

  it('should fill known variables in the preview and leave unknown ones', () => {
    expect(renderPreview('Order {order.reference} {foo}')).toBe('Order SHOP-4821 {foo}');
  });

  it('should offer only buyer-facing merge fields, each with a preview sample', () => {
    expect(BUYER_EMAIL_MERGE_FIELDS).toEqual([
      'order.reference',
      'order.total',
      'order.placedAt',
      'buyer.name',
      'shipment.tracking',
    ]);
    for (const field of BUYER_EMAIL_MERGE_FIELDS) {
      expect(renderPreview(`{${field}}`)).not.toBe(`{${field}}`);
    }
  });

  it('should map a server refusal to the field and template it names, and nothing else', () => {
    const message = 'config.buyerEmails: replyTo of "shipped" must be a single email address';
    expect(buyerEmailFieldOfServerMessage(message, 'shipped')).toBe('replyTo');
    expect(buyerEmailFieldOfServerMessage(message, 'return-received')).toBeNull();
    expect(buyerEmailFieldOfServerMessage('config.buyerEmails: must be an object', 'shipped')).toBeNull();
  });
});
