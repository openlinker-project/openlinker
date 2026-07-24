/**
 * Migration: seed the WooCommerce prompt template (#1840)
 *
 * Inserts version 1 of the `offer.description.suggest` template for the
 * `woocommerce` channel — the shop-publish counterpart to the `prestashop` /
 * `allegro` seeds in `SeedPromptTemplates1790000000001`. The shop-publish AI
 * flow (#1840) renders this template with the same product payload the offer
 * flow uses; channel-specific copy (WooCommerce block-editor HTML) lives in the
 * prompt text itself.
 *
 * Data-only seed — no schema change. Idempotent-by-uniqueness: the
 * `prompt_templates` partial unique indexes reject a duplicate
 * `(key, channel, version)`, so re-running against a DB that already carries the
 * row would fail; the `down` removes exactly this seeded row.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

const VARIABLES_JSON = JSON.stringify([
  { name: 'product.name', type: 'string', required: true },
  { name: 'product.attributes', type: 'object', required: false },
  { name: 'product.category', type: 'string', required: false },
  { name: 'tone', type: 'string', required: false },
  { name: 'extraInstructions', type: 'string', required: false },
]);

const WOOCOMMERCE_SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing product descriptions for a WooCommerce store. \
Write in a clean, persuasive, SEO-aware voice. Output semantic HTML compatible with the WooCommerce block/classic editor: wrap the summary \
in a <p>, list features as a <ul> of <li> bullets, and close with a short call-to-action paragraph. Never inline CSS or scripts. Write in \
the same language as the product name.`;

const WOOCOMMERCE_USER_TEMPLATE = `Write a long-form product description (120–220 words) for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Output only the HTML body — no <html>, <head>, or wrapping tags.`;

export class SeedWoocommercePromptTemplate1831000000000 implements MigrationInterface {
  name = 'SeedWoocommercePromptTemplate1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, 'woocommerce', 1, $2, $3, $4::jsonb, 'published', now(), NULL)
    `,
      [
        'offer.description.suggest',
        WOOCOMMERCE_SYSTEM_PROMPT,
        WOOCOMMERCE_USER_TEMPLATE,
        VARIABLES_JSON,
      ]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompt_templates" WHERE "key" = $1 AND "version" = 1 AND "channel" = 'woocommerce'`,
      ['offer.description.suggest']
    );
  }
}
