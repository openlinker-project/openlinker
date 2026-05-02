/**
 * Migration: seed master-channel prompt template (#490)
 *
 * Inserts the missing `(offer.description.suggest, channel=NULL, v1, published)`
 * row so master-tab AI suggestions stop 404-ing. The earlier seed
 * (`SeedPromptTemplates1790000000001`) only covered `prestashop` and `allegro`
 * — the null-channel master row was acknowledged-but-deferred at the time
 * (`content-suggestion.service.ts:70-72`) and is now bridged here.
 *
 * Idempotent via `ON CONFLICT DO NOTHING` against the partial unique index
 * "at most one published per (key, channel)" — environments where someone
 * manually inserted a master row keep theirs, this is a no-op.
 *
 * Variables shape mirrors the `prestashop`/`allegro` rows so the suggestion
 * flow can pass the same product payload regardless of channel.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

const VARIABLES_JSON = JSON.stringify([
  { name: 'product.name', type: 'string', required: true },
  { name: 'product.attributes', type: 'object', required: false },
  { name: 'product.category', type: 'string', required: false },
  { name: 'tone', type: 'string', required: false },
  { name: 'extraInstructions', type: 'string', required: false },
]);

const MASTER_SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing canonical product \
descriptions for the OpenLinker master catalogue. The master description is published \
directly into the shop's product-description field (today: PrestaShop), so output semantic \
HTML: wrap the summary in a <p>, list features as a <ul> of <li> bullets, and close with a \
short call-to-action paragraph. Never inline CSS or scripts. Write in the same language as \
the product name. Channel-specific publishers may further adapt the output for marketplace \
formats (e.g. Allegro block-formatted descriptions) — keep the HTML clean enough to survive \
that translation.`;

const MASTER_USER_TEMPLATE = `Write a master product description (120–220 words) for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Output only the HTML body — no <html>, <head>, or wrapping tags.`;

export class SeedMasterPromptTemplate1794000000000 implements MigrationInterface {
  name = 'SeedMasterPromptTemplate1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, NULL, 1, $2, $3, $4::jsonb, 'published', now(), NULL)
      ON CONFLICT DO NOTHING
      `,
      ['offer.description.suggest', MASTER_SYSTEM_PROMPT, MASTER_USER_TEMPLATE, VARIABLES_JSON],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompt_templates" WHERE "key" = $1 AND "version" = 1 AND "channel" IS NULL`,
      ['offer.description.suggest'],
    );
  }
}
