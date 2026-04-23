/**
 * Migration: seed baseline prompt templates
 *
 * Inserts version 1 of the `offer.description.suggest` template for the two
 * currently-supported channels (PrestaShop, Allegro). These are the prompts
 * the AI suggestion flow (#342) will render and send to the model until an
 * admin publishes a new version via the editor.
 *
 * Runs immediately after `AddPromptTemplatesTable1790000000000` — the two
 * share the `1790000000000` timestamp lane with the DDL's smaller suffix
 * ordering it first. TypeORM's migration runner executes them in strict
 * timestamp order, so the table is guaranteed to exist before this seed runs.
 *
 * Declared variables are identical across both channels so the suggestion
 * flow can feed them the same product payload. Channel-specific copy lives
 * in the prompt text itself (HTML+SEO for PrestaShop, block-formatted +
 * marketplace rules for Allegro).
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

const PRESTASHOP_SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing product descriptions for a PrestaShop shop. \
Write in a clean, persuasive, SEO-aware voice. Output semantic HTML: wrap the summary in a <p>, list features as a <ul> of <li> bullets, \
and close with a short call-to-action paragraph. Never inline CSS or scripts. Write in the same language as the product name.`;

const PRESTASHOP_USER_TEMPLATE = `Write a long-form product description (120–220 words) for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Output only the HTML body — no <html>, <head>, or wrapping tags.`;

const ALLEGRO_SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing product descriptions for Allegro listings. \
Allegro uses block-formatted descriptions (no free-form HTML beyond <h2>, <p>, <ul>/<li>, <b>). Respect the 20,000-character limit but \
aim for 400–900 characters of scannable copy. Always lead with one benefit-focused paragraph, then a bulleted feature list. Write in \
Polish by default unless the product name is clearly in another language, in which case match that language.`;

const ALLEGRO_USER_TEMPLATE = `Write an Allegro-ready product description for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Use only the Allegro-supported tags. Output only the description body.`;

export class SeedPromptTemplates1790000000001 implements MigrationInterface {
  name = 'SeedPromptTemplates1790000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, 'prestashop', 1, $2, $3, $4::jsonb, 'published', now(), NULL),
        ($1, 'allegro',    1, $5, $6, $4::jsonb, 'published', now(), NULL)
    `,
      [
        'offer.description.suggest',
        PRESTASHOP_SYSTEM_PROMPT,
        PRESTASHOP_USER_TEMPLATE,
        VARIABLES_JSON,
        ALLEGRO_SYSTEM_PROMPT,
        ALLEGRO_USER_TEMPLATE,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompt_templates" WHERE "key" = $1 AND "version" = 1 AND "channel" IN ('prestashop', 'allegro')`,
      ['offer.description.suggest'],
    );
  }
}
