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
 * self-closing `<br/>` requirement, and an 80,000-byte cap. This is a
 * SUPERSET of `ALLEGRO_DESCRIPTION_FORMAT`'s seven tags (`h1`/`h2`/`p`/`ul`/
 * `ol`/`li`/`b`, no `h3`, no `br`) — Erli additionally allows `h3` and a
 * self-closing `<br/>`, both of which Allegro's validator rejects
 * (`strong`/`em`/`i` still rewrite to `b` on both platforms). The prompt
 * below asks only for the Erli-allowed subset so a real completion needs no
 * `applyDescriptionFormat` rewriting to publish cleanly.
 *
 * Data-only seed — no schema change. The insert is `ON CONFLICT DO NOTHING`:
 * `channel` is open-world (#580) and the admin UI at `/ai/prompt-templates`
 * accepts an arbitrary channel string, so an Erli operator who hit this exact
 * gap may already have hand-authored an `erli` template as a workaround —
 * the bare `INSERT` this migration originally shipped would then abort
 * `migration:run` on `ux_prompt_templates_kcv_channel` /
 * `ux_prompt_templates_published_channel`. This is silent for a colliding
 * *draft* row too (a draft doesn't conflict on the published-uniqueness
 * index, but does conflict on the `(key, channel, version)` index) — the
 * seed reports success either way, with no published `erli` row and no log
 * line, so the regression this migration exists to close can persist
 * invisibly on an install that already has a draft v1 under this key.
 *
 * `down` must NOT unconditionally delete the row it may have declined to
 * insert: doing so would let a revert destroy an operator-authored `erli`
 * v1 template it never created. It therefore only deletes a row this
 * migration is known to have written — `created_by IS NULL` (every
 * operator-authored template carries a real actor id) AND the seeded
 * `system_prompt` text verbatim. A hand-authored row at a *different*
 * version is already unaffected by construction (the predicate is
 * `version = 1`); it's the v1 collision — the shape a workaround most
 * plausibly takes — that this guards.
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
kind, and no other tags. Respect the 80,000-byte limit but aim for 400–900 characters of scannable copy. Always lead with one \
benefit-focused paragraph, then a bulleted feature list. Write in Polish by default unless the product name is clearly in another \
language, in which case match that language.`;

const ERLI_USER_TEMPLATE = `Write an Erli-ready product description for the following product.

Product: {{product.name}}
Category: {{product.category}}
Attributes: {{product.attributes}}

Tone: {{tone}}
Additional instructions: {{extraInstructions}}

Use only <h1>/<h2>/<h3>/<p>/<b>/<br/>/<ol>/<ul>/<li>, no attributes, self-closing <br/>. Output only the description body.`;

export class SeedErliPromptTemplate1881000000000 implements MigrationInterface {
  name = 'SeedErliPromptTemplate1881000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "prompt_templates"
        ("key", "channel", "version", "system_prompt", "user_prompt_template", "variables", "state", "published_at", "created_by")
      VALUES
        ($1, 'erli', 1, $2, $3, $4::jsonb, 'published', now(), NULL)
      ON CONFLICT DO NOTHING
    `,
      ['offer.description.suggest', ERLI_SYSTEM_PROMPT, ERLI_USER_TEMPLATE, VARIABLES_JSON]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove the row this migration is known to have written — never an
    // operator-authored `erli` v1 template the `ON CONFLICT DO NOTHING` in
    // up() correctly declined to overwrite.
    await queryRunner.query(
      `
      DELETE FROM "prompt_templates"
      WHERE "key" = $1
        AND "version" = 1
        AND "channel" = 'erli'
        AND "created_by" IS NULL
        AND "system_prompt" = $2
    `,
      ['offer.description.suggest', ERLI_SYSTEM_PROMPT]
    );
  }
}
