/**
 * Migration: seed the Erli prompt template (#2202, PR review follow-up)
 *
 * Inserts version 1 of the `offer.description.suggest` template for the
 * `erli` channel — the `woocommerce` / `prestashop` / `allegro` seeds'
 * counterpart for the marketplace #3027 taught `MarketplaceOfferCreateHandler`
 * to actually resolve a channel for. Before this seed, an Erli offer create
 * with `generateDescription: true` resolved `channel: 'erli'` against a
 * `prompt_templates` table with no matching row — `PromptTemplateService.render`
 * throws `PromptTemplateNotFoundException` on an exact-match miss (there is
 * no channel→master fallback anywhere in the chain), which the handler's
 * existing AI-failure arm swallows into "no AI description at all", one
 * `warn`, no failed job. That was strictly worse than the pre-#3027 behaviour
 * of publishing Allegro-templated copy on Erli (the issue itself records
 * that copy as "usually still usable").
 *
 * Erli's HTML grammar is declared by `ERLI_DESCRIPTION_FORMAT`
 * (`libs/integrations/erli/src/infrastructure/adapters/erli-description-format.ts`):
 * nine tags (`h1`/`h2`/`h3`/`p`/`b`/`br`/`ol`/`ul`/`li`), no attributes, a
 * self-closing `<br/>` requirement, and an 80,000-byte cap — narrower than
 * Allegro's block-formatted subset (no `h1`, `strong`/`em` survive as `b`).
 * The prompt below asks only for that subset so a real completion needs no
 * `applyDescriptionFormat` rewriting to publish cleanly.
 *
 * Data-only seed — no schema change. Idempotent-by-uniqueness: the
 * `prompt_templates` partial unique indexes reject a duplicate
 * `(key, channel, version)`, so re-running against a DB that already carries
 * the row would fail; the `down` removes exactly this seeded row.
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

const ERLI_SYSTEM_PROMPT = `You are a senior e-commerce copywriter producing product descriptions for Erli marketplace listings. \
Erli accepts only a narrow HTML subset: <h1>, <h2>, <h3>, <p>, <b>, <br/> (always self-closing), <ol>/<ul> of <li>. No attributes of any \
kind, and no other tags. Respect the 80,000-character limit but aim for 400–900 characters of scannable copy. Always lead with one \
benefit-focused paragraph, then a bulleted feature list. Write in Polish by default unless the product name is clearly in another \
language, in which case match that language.`;

const ERLI_USER_TEMPLATE = `Write an Erli-ready product description for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Use only <h1>/<h2>/<h3>/<p>/<b>/<br/>/<ol>/<ul>/<li>, no attributes, self-closing <br/>. Output only the description body.`;

export class SeedErliPromptTemplate1878000000000 implements MigrationInterface {
  name = 'SeedErliPromptTemplate1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, 'erli', 1, $2, $3, $4::jsonb, 'published', now(), NULL)
    `,
      ['offer.description.suggest', ERLI_SYSTEM_PROMPT, ERLI_USER_TEMPLATE, VARIABLES_JSON]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompt_templates" WHERE "key" = $1 AND "version" = 1 AND "channel" = 'erli'`,
      ['offer.description.suggest']
    );
  }
}
