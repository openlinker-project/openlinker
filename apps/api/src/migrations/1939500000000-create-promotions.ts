/**
 * Promotions (#3935): gift rules move out of the automation tables.
 *
 * A gift rule was an `automation_rules` row (trigger `order.ingested`, one
 * `add-gift` action) with its mutable state in `automation_gift_rule_state`, its
 * ledger in `automation_gift_grants` and its history in `automation_runs`. That
 * borrowed the automation engine's vocabulary for something it is not (a promotion
 * is not an event-triggered action), so the `promotions` context owns it now:
 *  - `promotions` - the definition (conditions, benefit, combinability, limits);
 *  - `promotion_state` - pause and raised cap;
 *  - `promotion_grants` - one row per (promotion, order), the idempotency key;
 *  - `promotion_applications` - the append-only application log.
 *
 * Every id is KEPT, so an order line's `gift.ruleRef`, a grant, a pause and the
 * gift report keep pointing at the same thing. `definitionHash` is recomputed
 * with a canonicalisation COPIED into this file (a migration must keep meaning
 * what it meant when it ran; an import would change it the next time the
 * canonicaliser is edited). The old gift rows, their runs, the two gift tables and
 * `automation_rules.position` are then removed.
 *
 * `down()` reverses it: the automation rows, ledger and runs are rebuilt from the
 * promotion tables (the runs best-effort, from the log's code and message).
 *
 * Declared on the ORM entities as well, because the integration harness builds
 * schema by `synchronize`.
 *
 * Generated: 2026-11-10 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import { createHash } from 'node:crypto';

import type { MigrationInterface, QueryRunner } from 'typeorm';

interface RuleRow {
  id: string;
  name: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  conditions: unknown[];
  actions: unknown[];
  position: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface GiftAction {
  action: 'add-gift';
  productId: string;
  variantId: string;
  quantity: number;
  perUnit: unknown;
  unitCap: number | null;
  skipIfPresent: boolean;
  doNotCombine: boolean;
  customerLimit: number | null;
  documentForm?: string;
}

function isGiftAction(value: unknown): value is GiftAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { action?: unknown }).action === 'add-gift'
  );
}

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) ordered[key] = withSortedKeys(source[key]);
  return ordered;
}

/** The promotion definition hash, as the `promotions` context computed it when this ran. */
function promotionHash(
  conditions: unknown[],
  benefit: unknown,
  combinable: boolean,
  limits: { unitCap: number | null; customerLimit: number | null }
): string {
  const sorted = conditions
    .map(withSortedKeys)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256')
    .update(
      JSON.stringify({
        conditions: sorted,
        benefit: withSortedKeys(benefit),
        combinable,
        limits: withSortedKeys(limits),
      })
    )
    .digest('hex');
}

/** The automation rule definition hash, as `automation` computed it before the move (for `down()`). */
function automationHash(conditions: unknown[], actions: unknown[]): string {
  const sorted = [...conditions]
    .sort((a, b) =>
      String((a as { field?: unknown }).field).localeCompare(String((b as { field?: unknown }).field))
    )
    .map(withSortedKeys);
  return createHash('sha256')
    .update(
      JSON.stringify({
        trigger: 'order.ingested',
        triggerConfig: {},
        conditions: sorted,
        actions: actions.map(withSortedKeys),
      })
    )
    .digest('hex');
}

export class CreatePromotions1939500000000 implements MigrationInterface {
  name = 'CreatePromotions1939500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "promotions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "isActive" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL,
        "effectiveFrom" date NOT NULL,
        "effectiveTo" date,
        "conditions" jsonb NOT NULL DEFAULT '[]',
        "benefit" jsonb NOT NULL,
        "combinable" boolean NOT NULL DEFAULT true,
        "unitCap" integer,
        "customerLimit" integer,
        "definitionHash" character varying(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotions" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_promotions_hash_from" ON "promotions" ("definitionHash", "effectiveFrom")`
    );
    await queryRunner.query(`CREATE INDEX "IDX_promotions_position" ON "promotions" ("position")`);
    await queryRunner.query(
      `CREATE TABLE "promotion_state" (
        "promotionId" uuid NOT NULL,
        "pausedReason" character varying(32),
        "pausedAt" TIMESTAMP WITH TIME ZONE,
        "capExtension" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_state" PRIMARY KEY ("promotionId")
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "promotion_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promotionId" uuid NOT NULL,
        "internalOrderId" text NOT NULL,
        "customerId" text,
        "quantity" integer NOT NULL,
        "productId" text NOT NULL,
        "variantId" text NOT NULL,
        "documentForm" character varying(32),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_grants" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_promotion_grants_promotion_order" ON "promotion_grants" ("promotionId", "internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_grants_promotion_customer" ON "promotion_grants" ("promotionId", "customerId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_grants_order" ON "promotion_grants" ("internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_grants_variant" ON "promotion_grants" ("variantId", "createdAt")`
    );
    await queryRunner.query(
      `CREATE TABLE "promotion_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promotionId" uuid NOT NULL,
        "promotionName" text NOT NULL,
        "internalOrderId" text NOT NULL,
        "outcome" character varying(16) NOT NULL,
        "reason" character varying(64),
        "quantity" integer NOT NULL DEFAULT 0,
        "message" text,
        "dismissedAt" TIMESTAMP WITH TIME ZONE,
        "dismissedByUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_applications" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_applications_order" ON "promotion_applications" ("internalOrderId", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_promotion_applications_promotion" ON "promotion_applications" ("promotionId", "createdAt")`
    );

    // ---- copy: definitions (ids kept, positions made dense and non-null) ----
    const rules = (await queryRunner.query(
      `SELECT "id", "name", "isActive", "effectiveFrom"::text AS "effectiveFrom",
              "effectiveTo"::text AS "effectiveTo", "conditions", "actions", "position",
              "createdAt", "updatedAt"
         FROM "automation_rules"
        WHERE "trigger" = 'order.ingested'
        ORDER BY "position" ASC NULLS LAST, "createdAt" ASC, "id" ASC`
    )) as RuleRow[];
    let position = 0;
    for (const rule of rules) {
      const action = rule.actions.find(isGiftAction);
      // A gift rule with no readable gift cannot say what it gives, so it is not
      // carried over (the read path already dropped such a step).
      if (action === undefined) continue;
      position += 1;
      const benefit: Record<string, unknown> = {
        kind: 'free-gift',
        productId: action.productId,
        variantId: action.variantId,
        quantity: action.quantity,
        perUnit: action.perUnit ?? null,
        skipIfPresent: action.skipIfPresent,
        ...(action.documentForm !== undefined && { documentForm: action.documentForm }),
      };
      const combinable = !action.doNotCombine;
      const limits = { unitCap: action.unitCap ?? null, customerLimit: action.customerLimit ?? null };
      await queryRunner.query(
        `INSERT INTO "promotions" ("id","name","isActive","position","effectiveFrom","effectiveTo",
           "conditions","benefit","combinable","unitCap","customerLimit","definitionHash","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
        [
          rule.id,
          rule.name,
          rule.isActive,
          position,
          rule.effectiveFrom,
          rule.effectiveTo,
          JSON.stringify(rule.conditions),
          JSON.stringify(benefit),
          combinable,
          limits.unitCap,
          limits.customerLimit,
          promotionHash(rule.conditions, benefit, combinable, limits),
          rule.createdAt,
          rule.updatedAt,
        ]
      );
    }

    // ---- copy: state, grants (ids kept) and the run history ----
    await queryRunner.query(
      `INSERT INTO "promotion_state" ("promotionId","pausedReason","pausedAt","capExtension","updatedAt")
       SELECT "ruleId","pausedReason","pausedAt","capExtension","updatedAt" FROM "automation_gift_rule_state"`
    );
    await queryRunner.query(
      `INSERT INTO "promotion_grants"
         ("id","promotionId","internalOrderId","customerId","quantity","productId","variantId","documentForm","createdAt")
       SELECT "id","ruleId","internalOrderId","customerId","quantity","productId","variantId","documentForm","createdAt"
         FROM "automation_gift_grants"`
    );
    await queryRunner.query(
      `INSERT INTO "promotion_applications"
         ("id","promotionId","promotionName","internalOrderId","outcome","reason","quantity","message",
          "dismissedAt","dismissedByUserId","createdAt")
       SELECT r."id", r."ruleId", r."ruleName", r."subjectId",
              CASE r."outcome" WHEN 'done' THEN 'applied' WHEN 'failed' THEN 'failed' ELSE 'skipped' END,
              COALESCE(r."steps"->0->>'reasonCode',
                       substring(r."steps"->0->>'detail' from '^No gift added: (.+)\\.$')),
              COALESCE((substring(r."steps"->0->>'detail' from '^Added ([0-9]+) gift'))::int, 0),
              r."steps"->0->>'detail',
              r."dismissedAt", r."dismissedByUserId", r."firedAt"
         FROM "automation_runs" r
        WHERE r."trigger" = 'order.ingested'`
    );

    // ---- remove the old homes ----
    await queryRunner.query(`DELETE FROM "automation_runs" WHERE "trigger" = 'order.ingested'`);
    await queryRunner.query(`DELETE FROM "automation_rules" WHERE "trigger" = 'order.ingested'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_variant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_gift_grants_rule_customer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_automation_gift_grants_rule_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_gift_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_gift_rule_state"`);
    await queryRunner.query(`ALTER TABLE "automation_rules" DROP COLUMN IF EXISTS "position"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "automation_rules" ADD COLUMN "position" integer`);
    await queryRunner.query(
      `CREATE TABLE "automation_gift_rule_state" (
        "ruleId" uuid NOT NULL,
        "pausedReason" character varying(32),
        "pausedAt" TIMESTAMP WITH TIME ZONE,
        "capExtension" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_gift_rule_state" PRIMARY KEY ("ruleId")
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "automation_gift_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId" uuid NOT NULL,
        "internalOrderId" text NOT NULL,
        "customerId" text,
        "quantity" integer NOT NULL,
        "productId" text NOT NULL,
        "variantId" text NOT NULL,
        "documentForm" character varying(32),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_gift_grants" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_automation_gift_grants_rule_order" ON "automation_gift_grants" ("ruleId", "internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_rule_customer" ON "automation_gift_grants" ("ruleId", "customerId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_order" ON "automation_gift_grants" ("internalOrderId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_automation_gift_grants_variant" ON "automation_gift_grants" ("variantId", "createdAt")`
    );

    interface PromotionRow {
      id: string;
      name: string;
      isActive: boolean;
      position: number;
      effectiveFrom: string;
      effectiveTo: string | null;
      conditions: unknown[];
      benefit: Record<string, unknown>;
      combinable: boolean;
      unitCap: number | null;
      customerLimit: number | null;
      createdAt: Date;
      updatedAt: Date;
    }
    const promotions = (await queryRunner.query(
      `SELECT "id","name","isActive","position","effectiveFrom"::text AS "effectiveFrom",
              "effectiveTo"::text AS "effectiveTo","conditions","benefit","combinable","unitCap",
              "customerLimit","createdAt","updatedAt"
         FROM "promotions" ORDER BY "position" ASC`
    )) as PromotionRow[];
    for (const p of promotions) {
      const action = {
        action: 'add-gift',
        productId: p.benefit.productId,
        variantId: p.benefit.variantId,
        quantity: p.benefit.quantity,
        perUnit: p.benefit.perUnit ?? null,
        unitCap: p.unitCap,
        skipIfPresent: p.benefit.skipIfPresent,
        doNotCombine: !p.combinable,
        customerLimit: p.customerLimit,
        ...(p.benefit.documentForm !== undefined && { documentForm: p.benefit.documentForm }),
      };
      await queryRunner.query(
        `INSERT INTO "automation_rules" ("id","name","trigger","triggerConfig","conditions","actions",
           "definitionHash","isActive","effectiveFrom","effectiveTo","position","createdAt","updatedAt")
         VALUES ($1,$2,'order.ingested','{}'::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7::date,$8::date,$9,$10,$11)`,
        [
          p.id,
          p.name,
          JSON.stringify(p.conditions),
          JSON.stringify([action]),
          automationHash(p.conditions, [action]),
          p.isActive,
          p.effectiveFrom,
          p.effectiveTo,
          p.position,
          p.createdAt,
          p.updatedAt,
        ]
      );
    }

    await queryRunner.query(
      `INSERT INTO "automation_gift_rule_state" ("ruleId","pausedReason","pausedAt","capExtension","updatedAt")
       SELECT "promotionId","pausedReason","pausedAt","capExtension","updatedAt" FROM "promotion_state"`
    );
    await queryRunner.query(
      `INSERT INTO "automation_gift_grants"
         ("id","ruleId","internalOrderId","customerId","quantity","productId","variantId","documentForm","createdAt")
       SELECT "id","promotionId","internalOrderId","customerId","quantity","productId","variantId","documentForm","createdAt"
         FROM "promotion_grants"`
    );
    await queryRunner.query(
      `INSERT INTO "automation_runs"
         ("id","ruleId","ruleName","trigger","subjectKind","subjectId","outcome","steps","firedAt",
          "dismissedAt","dismissedByUserId","createdAt")
       SELECT a."id", a."promotionId", a."promotionName", 'order.ingested', 'order', a."internalOrderId",
              CASE a."outcome" WHEN 'applied' THEN 'done' WHEN 'failed' THEN 'failed' ELSE 'nothing-to-do' END,
              jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                'stepIndex', 0, 'action', 'add-gift',
                'status', CASE a."outcome" WHEN 'applied' THEN 'done' WHEN 'failed' THEN 'failed' ELSE 'nothing-to-do' END,
                'detail', a."message", 'reasonCode', a."reason"))),
              a."createdAt", a."dismissedAt", a."dismissedByUserId", a."createdAt"
         FROM "promotion_applications" a`
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotion_applications_promotion"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotion_applications_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotion_applications"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotion_grants_variant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotion_grants_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotion_grants_promotion_customer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_promotion_grants_promotion_order"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotion_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotion_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_promotions_position"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_promotions_hash_from"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotions"`);
  }
}
