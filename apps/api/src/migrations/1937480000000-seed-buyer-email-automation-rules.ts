/**
 * Seed Buyer Email Automation Rules Migration
 *
 * #3554: four INACTIVE automation rules, one per buyer-email template (order
 * confirmed, shipped, document issued, return received). Each is a single
 * `send-email` step to the buyer, marked with `buyerEmailTemplate`, so it goes
 * through the connection opt-in (`config.buyerEmails`) before anything is sent.
 * Inactive, and the opt-in is off by default, so an upgrade sends nothing new;
 * the operator edits the wording and switches a rule on through the automation
 * rules API.
 *
 * `definitionHash` is computed by a canonicalisation COPIED here rather than
 * imported (the #3189 rule: a migration must keep meaning what it meant when it
 * ran). A spec pins it against `computeAutomationDefinitionHash`, so drift fails
 * the build instead of seeding a rule the duplicate guard does not recognise.
 * `ON CONFLICT DO NOTHING` on the duplicate guard's unique index keeps a re-run
 * harmless; `down()` removes exactly these ids.
 *
 * Generated: 2026-10-29 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

interface SeedRule {
  id: string;
  name: string;
  trigger: string;
  actions: Array<Record<string, unknown>>;
}

const buyerEmail = (
  template: string,
  subject: string,
  body: string
): Record<string, unknown> => ({
  action: 'send-email',
  recipient: { kind: 'buyer' },
  subject,
  body,
  buyerEmailTemplate: template,
});

export const BUYER_EMAIL_SEED_RULES: readonly SeedRule[] = [
  {
    id: '6c1f3a52-3554-4a00-8000-000000000001',
    name: 'Buyer email: order confirmed',
    trigger: 'order.received',
    actions: [
      buyerEmail(
        'order-confirmed',
        'We received your order {order.reference}',
        'Hello {buyer.name},\n\nThank you for your order {order.reference} ({order.total}). We will let you know when it ships.'
      ),
    ],
  },
  {
    id: '6c1f3a52-3554-4a00-8000-000000000002',
    name: 'Buyer email: shipped',
    trigger: 'order.shipped',
    actions: [
      buyerEmail(
        'shipped',
        'Your order {order.reference} is on its way',
        'Hello {buyer.name},\n\nYour order {order.reference} has shipped. Tracking number: {shipment.tracking}.'
      ),
    ],
  },
  {
    id: '6c1f3a52-3554-4a00-8000-000000000003',
    name: 'Buyer email: document issued',
    trigger: 'order.document_issued',
    actions: [
      buyerEmail(
        'document-issued',
        'Your invoice for order {order.reference}',
        'Hello {buyer.name},\n\nThe sales document for your order {order.reference} has been issued.'
      ),
    ],
  },
  {
    id: '6c1f3a52-3554-4a00-8000-000000000004',
    name: 'Buyer email: return received',
    trigger: 'return.received',
    actions: [
      buyerEmail(
        'return-received',
        'We received your return for order {order.reference}',
        'Hello {buyer.name},\n\nYour return for order {order.reference} has arrived at our warehouse. We will process it shortly.'
      ),
    ],
  },
];

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) ordered[key] = withSortedKeys(source[key]);
  return ordered;
}

/** Copy of `computeAutomationDefinitionHash` for a rule with no conditions and an empty config. */
export function seedDefinitionHash(rule: SeedRule): string {
  const canonical = JSON.stringify({
    trigger: rule.trigger,
    triggerConfig: withSortedKeys({}),
    conditions: [],
    actions: rule.actions.map(withSortedKeys),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class SeedBuyerEmailAutomationRules1937480000000 implements MigrationInterface {
  name = 'SeedBuyerEmailAutomationRules1937480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const rule of BUYER_EMAIL_SEED_RULES) {
      await queryRunner.query(
        `INSERT INTO "automation_rules"
           ("id", "name", "trigger", "triggerConfig", "conditions", "actions",
            "definitionHash", "isActive", "effectiveFrom")
         VALUES ($1, $2, $3, '{}'::jsonb, '[]'::jsonb, $4::jsonb, $5, false, CURRENT_DATE)
         ON CONFLICT DO NOTHING`,
        [rule.id, rule.name, rule.trigger, JSON.stringify(rule.actions), seedDefinitionHash(rule)]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "automation_rules" WHERE "id" = ANY($1::uuid[])`, [
      BUYER_EMAIL_SEED_RULES.map((rule) => rule.id),
    ]);
  }
}
