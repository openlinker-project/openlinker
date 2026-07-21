# Implementation Plan: Theme-aware transactional email layout (#1748)

Design artifact (approved): https://claude.ai/code/artifact/12a735c2-d348-4423-bbaf-a713b7704c75

## 1. Understand

Replace the hardcoded indigo email styling with a shared, theme-aware layout whose
colors are derived (at design time, as hex constants) from the app design tokens in
`apps/web/src/index.css`, and give the password-reset email an HTML body.

- **Layer**: Interface (API outbound email rendering, `apps/api/src/auth`).
- **Non-goals**: the two future templates from the artifact (password-changed notice,
  connection re-auth alert); any runtime coupling to `apps/web`; changing mailer
  transports or `MailerPort`.

## 2. Research

- `apps/api/src/auth/templates/confirmation-email.template.ts` - only HTML email today;
  local indigo constants; `escapeHtml` helper; table-based inline-styled markup; input
  interface colocated in the template file (folder precedent).
- `apps/api/src/auth/adapters/mailer-password-reset-notifier.adapter.ts` - text-only;
  has `ConfigService`; reset TTL key `PASSWORD_RESET_TTL_MINUTES` (default 60, mirrors
  `password-reset.service.ts`).
- `MailerPort.sendEmail` already accepts optional `html`.
- Collision check (pre-implement essence; full gate skipped as trivial/self-contained):
  no existing `email-layout.template.ts`, no `renderPasswordResetEmailHtml`, the only
  `#4f46e5` in the repo is the file being rewritten.

## 3. Design

One pure-function layout module; templates compose it. Light palette inlined per
element (always-works baseline); dark palette applied by a `<style>` block in `<head>`
under `@media (prefers-color-scheme: dark)` using `!important` class overrides
(standard email dark-mode mechanism; Gmail falls back to light).

## 4. Steps

1. `apps/api/src/auth/templates/email-layout.template.ts` (new)
   - `EMAIL_COLORS` (light/dark hex sets from the artifact's token mapping), font
     stacks, `escapeHtml`, `renderCtaButton`, `renderFallbackLinkWell`,
     `renderEmailLayout({ title, eyebrow, contentHtml, metaHtml })`.
   - Shell: color-scheme metas + dark-mode style block, wordmark ("Linker" in accent)
     + mono eyebrow, connector mark (dot-line-dot in accent), content slot, meta
     footer with top rule, outside-card tagline.
2. Rewrite `confirmation-email.template.ts` on the layout; delete indigo constants;
   keep `ConfirmationEmailTemplateInput` and escaping semantics.
3. `apps/api/src/auth/templates/password-reset-email.template.ts` (new) -
   `renderPasswordResetEmailHtml({ username, link, ttlMinutes })`.
4. `mailer-password-reset-notifier.adapter.ts` - read `PASSWORD_RESET_TTL_MINUTES`
   (default 60), pass `html` alongside the existing `text`.
5. Tests: extend `confirmation-email.template.spec.ts` (dark-mode block, both
   palettes, no indigo, escaping); new `password-reset-email.template.spec.ts`.

## 5. Validate

- Boundaries: no `apps/web` imports; pure functions, no Nest/DI changes; templates
  stay in the API interface layer. No migration. Quality gate scoped to
  `@openlinker/api` + full lint/type-check.
