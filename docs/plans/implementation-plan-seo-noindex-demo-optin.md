# Implementation Plan — noindex admin SPA by default, build-time opt-in for the public demo (#3709)

## 1. Task understanding

**Goal.** By default, search engines must not index the admin SPA (`apps/web`), because self-hosted instances are private operator panels. Exactly one deployment, the public demo at `app.demo.openlinker.io`, can opt in at build time to being indexable, with a brand-carrying title, description and canonical. The demo also links back to openlinker.io and the docs.

**Classification.** Frontend (Interface) + DX (build/deploy config). No backend, CORE or migration impact.

**Constraints**
- Demo mode is a runtime API flag (`/v1/system/config`). Google does not render a page whose initial HTML says `noindex`, so the robots directive must come from build-time HTML, not JS.
- Only `VITE_*` vars reach browser builds (`docs/frontend-architecture.md` § Environment Variables). Each environment builds its own artifact, which satisfies § Runtime Configuration.
- `head-manifest.test.ts` whitelists `%TOKEN%`s. An unlisted token is treated as a shipped-literal bug (#2175).

**Non-goals**
- Per-route `document.title`.
- Demo host reverse-proxy config (the 204 favicon), which lives on the server.
- Marketing-site and docs-site SEO, which are in the companion issues `openlinker-website#61` and `openlinker-docs#13`.

## 2. Research — existing patterns reused

- `apps/web/src/build-time/og-meta.ts` (#2174) resolves `%OG_*%` tokens from `VITE_OG_*` envs, with whole-line tag tokens (`%OG_URL_TAG%`) and attribute escaping. The new tokens extend this same module; no new plugin is added.
- `apps/web/src/test/og-meta-plugin.test.ts` already holds per-env render cases. New cases follow the same shape.
- The `VITE_OL_*` naming precedent is `VITE_OL_OMS_ROUTING_UI_ENABLED` (#3634), wired through Dockerfile → compose → CD.
- The demo-mode-only UI precedent is the `demoMode` prop in `LoginForm.tsx` (demo bar, register CTA).

## 3. Design

New `OgMetaEnv.VITE_OL_SEO_INDEXABLE`. `indexable = flag === 'true' && siteUrl !== ''`. A canonical without an absolute origin is worse than none, so the flag alone never makes a build indexable.

| Token | Default build | Indexable build |
|---|---|---|
| `%PAGE_TITLE%` | `OpenLinker Admin` | `OpenLinker Demo – open-source e-commerce orchestration platform` |
| `%PAGE_DESCRIPTION%` | `E-commerce orchestration platform` | `Live read-only demo of OpenLinker, the open-source, self-hosted platform that syncs orders, inventory and listings between your shop and marketplaces.` |
| `%ROBOTS_TAG%` (whole line) | `<meta name="robots" content="noindex, nofollow" />` | `<meta name="robots" content="index, follow" />` |
| `%CANONICAL_TAG%` (whole line) | *(line removed)* | `<link rel="canonical" href="{siteUrl}/" />` |

`%OG_TITLE_PREFIX%` keeps prefixing title and description as today.

## 4. Steps

1. `apps/web/src/build-time/og-meta.ts`
   - Extend `OgMetaEnv` and `ResolvedOgMeta`.
   - Resolve the four values.
   - Substitute in `renderOgMeta`; the `*_TAG` tokens use the existing whole-line pattern.
   - Update the header doc.
2. `apps/web/index.html`
   - Replace the hard-coded `OpenLinker Admin` / `E-commerce orchestration platform` in `<title>`, meta description and og/twitter title and description with `%PAGE_TITLE%` / `%PAGE_DESCRIPTION%`.
   - Add the `%ROBOTS_TAG%` and `%CANONICAL_TAG%` lines.
3. `apps/web/src/test/head-manifest.test.ts`: add the 4 tokens to `ALLOWED_HTML_TOKENS`.
4. `apps/web/src/test/og-meta-plugin.test.ts`: add cases for
   - the default build (noindex, no canonical, admin title);
   - flag without origin (still noindex);
   - flag + origin (index, canonical, demo title in title/description/og/twitter);
   - a flag value other than `'true'` (noindex).
5. `apps/web/public/robots.txt`: `User-agent: *` / `Allow: /`. Crawling stays allowed so the `noindex` can be read.
6. Wiring, following the `VITE_OL_OMS_ROUTING_UI_ENABLED` precedent:
   - `apps/web/Dockerfile`: ARG/ENV plus a header comment.
   - `.github/workflows/cd.yml`: `--build-arg`.
   - `docker-compose.demo.yml`: arg with an empty default.
   - `apps/web/.env.example`: document the variable and fix the demo origin to `https://app.demo.openlinker.io`, also in the compose comment.
7. `apps/web/src/features/auth/components/LoginForm.tsx`: in the demo bar only, add crawlable `<a>` links to openlinker.io, docs.openlinker.io and GitHub. Cover them in the existing LoginForm test.
8. `README.md` line 8 and `llms.txt`: add Docs and Live demo links.

## 5. Validation

- **Architecture:** FE-only; the build-time module stays outside layer rules (`build-time/` is never imported by the app). No new pattern.
- **Security:** no secrets; the public `VITE_*` var only toggles meta tags. Default-deny (noindex) is the safe failure mode.
- **Rollout risk:** shipping this before the GitHub `demo` environment sets `VITE_OL_SEO_INDEXABLE=true` and `VITE_OG_SITE_URL=https://app.demo.openlinker.io` would de-index the demo. This goes in the PR description as a release prerequisite.
- **Quality gate:** `pnpm lint`, `pnpm type-check`, `pnpm test`.
