# Modularity & Plugin-Readiness Review — 2026-05-09

> **TL;DR — read these five points if nothing else:**
> 1. **No LICENSE file** — repo is legally All-Rights-Reserved by GitHub default; external contribution is blocked at step zero (`README.md:184` still says `[Add your license here]`).
> 2. **Adapter registry is a hardcoded inline `Map` + `Capability`/`EntityType` are closed `as const` unions in core** — adding a platform/capability/entity-type requires editing `libs/core` today. Both closed unions **regressed against the architecture doc's own openly-typed contract**.
> 3. **`@openlinker/core` declares NestJS/TypeORM as `dependencies`** (not `peerDependencies`) — the moment a plugin installs from npm, two copies of `@nestjs/common` will coexist and DI will silently break.
> 4. **Core orchestration code (sync runner, scheduler, customer identity, inventory propagation) carries hardcoded `'allegro'`/`'prestashop'` literals** — a plugin's mappings/jobs/emails get silently dropped.
> 5. **No plugin author guide, no scaffolding, no CODEOWNERS, broken CONTRIBUTING.md** — a stranger has no path from "I want to add Platform X" to "PR opened."
>
> The architectural shape is good (hexagonal layering holds, capability ports are well-typed). Almost every blocker is mechanical to fix — see §Sequenced Roadmap.

---

**Reviewer**: Senior Tech Lead audit (synthesized from four parallel sub-audits — backend plugin architecture, frontend plugin architecture, public API / SDK readiness, OSS contributor DX).
**Audience**: OpenLinker maintainers + future external OSS contributors.
**Total findings**: **58** — 9 BLOCKER · 24 HIGH · 17 MEDIUM · 8 LOW.
**Scope**: Backend (`libs/core`, `libs/integrations`, `libs/shared`, `apps/api`, `apps/worker`) and frontend (`apps/web`), with explicit attention to: (a) **today** — in-tree plugin contribution under `libs/integrations/<platform>/`; and (b) **future** — out-of-tree plugins published to npm (`@third-party/openlinker-plugin-shopify`) discovered at boot via a manifest. The audit favours (a) being smooth and (b) being reachable without a rewrite.

> **Severity rubric note**: This review uses **BLOCKER / HIGH / MEDIUM / LOW** (4-tier) rather than the 3-tier 🔴 Blocking / 🟡 Strong Recommendation / 🟢 Optional in `code-review-guide.md:251-277`. The split between BLOCKER and HIGH is deliberate for plugin-readiness sequencing — "blocks OSS contribution at step zero" is meaningfully different from "in-tree contribution is painful." When mapping to GitHub labels, BLOCKER + HIGH map to 🔴; MEDIUM → 🟡; LOW → 🟢.

> **Footnote on standards-doc inconsistency**: `engineering-standards.md:93` says integration tests use `*.integration.spec.ts`, but `testing-guide.md:47` and `CLAUDE.md` (and the codebase) say `*.int-spec.ts`. The standards docs themselves are internally inconsistent. Out of scope for this review — track separately.

> **Trust note**: BLOCKER findings and a sample of HIGH findings were spot-verified by the synthesizer against the live codebase. See §Appendix — Methodology for the verification log. File:line citations on those findings are real; remaining findings carry sub-agent cites that should be confirmed before acting.

---

## Executive Summary

OpenLinker has the **architectural shape** of a modular plugin platform: hexagonal layering is genuinely respected, capability ports use the right idioms (Symbol DI tokens, `as const` + type-guard sub-capabilities, port→adapter→factory layering), and integration packages already self-register at module-init through an `AdapterFactoryResolverService`. Two integrations (`prestashop`, `allegro`) prove that adding a platform is mechanically possible. The frontend is similarly clean as a monolith — the documented `app → pages → features → shared` direction holds, and `shared` is **genuinely** clean of `features`/`pages` imports.

OpenLinker does **not yet have the plugin-readiness substance** that shape implies. The single most damaging issue is legal: the repository has **no LICENSE file** (`README.md:184` reads `[Add your license here]`), which makes the codebase All-Rights-Reserved by GitHub default and bars contribution from any company that does open-source diligence. After that, the failure modes cluster into eight repeatable patterns:

- **Two parallel registries with inconsistent semantics**: `AdapterFactoryResolverService` already exposes `registerFactory()` at runtime, but the read-only metadata service `AdapterRegistryService` is a hardcoded inline `Map` (`libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts:25-47`). The asymmetry between them is the bug.
- **Closed `as const` unions in core regressed against documented intent**: `Capability` (`libs/core/src/integrations/domain/types/adapter.types.ts:18-33`) and `EntityType` (`libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts:9-19`) are closed today even though `architecture-overview.md:478-480, 528-533` documents both as open-extension contracts (the future-capability list and the explicit `entityType: '...' | string` port signature, respectively).
- **Core orchestration carries platform literals**: `apps/api` and `apps/worker` static-import every integration by name; `SyncJobRunner` imports `AllegroApiException` from `@openlinker/integrations-allegro`; `inventory.propagateToMarketplaces` filters mappings to `=== 'allegro'`; `SchedulerService` hardcodes Allegro cron tasks; `CustomerIdentityResolverService` hardcodes Allegro email normalization. This is one recurring anti-pattern (literal-equality dispatch on `platformType`) — see §Priority Threads box below.
- **SDK-publishing landmines**: `@openlinker/core` and `@openlinker/shared` declare NestJS, TypeORM, ConfigService as `dependencies` rather than `peerDependencies`; `Logger` extends `@nestjs/common.Logger`; ORM entities leak through public barrels; `ai`/`content` are missing from the top-level barrel; package.json `exports` permits deep-path subpaths through wildcard patterns.
- **Plugin-owned database schema has no path**: `migrations.md:21` states `apps/api` owns the database schema. A plugin shipping its own ORM entities cannot ship its own migrations alongside.
- **Frontend has zero plugin extension points**: no `slot`/`extension`/`plugin`/`register` pattern exists anywhere in `apps/web/src`; `ApiClient` is a closed interface listing 18 features by name; routes are eagerly imported in a 24-child static array; `shared/` contains marketplace-specific code (`allegro-error-list.tsx`) violating its own documented rule; `CreateOfferWizard.tsx` (1062 lines) is wired to Allegro semantics throughout.
- **Onboarding surface is broken**: `CONTRIBUTING.md` has a placeholder repo URL, wrong base branch (`develop` instead of `main`), wrong migration command, incomplete dev-stack startup; CI uses `self-hosted` runners (fork PRs from external contributors get no CI signal); three different repository URLs across README, CONTRIBUTING, and issue-template config.

The encouraging news: most of these are **mechanical** to fix. The hard architectural design (port shape, Symbol-token DI, capability sub-interfaces, `AdapterFactoryResolverService`) is already correct. Open the closed unions, lift the registry from "static map" to "register-at-onModuleInit", move framework deps to peer-deps, extract a small `@openlinker/plugin-sdk` package, write the missing docs, fix the LICENSE — and OpenLinker can credibly claim plugin readiness within one focused milestone. **Nothing in this review demands re-architecture.** Several findings (D1/BE-3, D2/SDK-2, F2/SDK-4, E7/BE-12) are also code-vs-doc drifts where the architecture doc's stated intent already supports plugin extension; the fix is closing the drift.

The recommended sequencing is captured in **§ Sequenced Roadmap**. The eight priority threads in **§ Priority Threads** are how I'd group these into milestones / GitHub issue parents.

---

## Verdict

| Question | Answer |
|---|---|
| Is the codebase modular? | **Yes — structurally.** Hexagonal boundaries hold, capability ports are well-shaped, `shared/` is clean. |
| Can contributors easily add their plugins/modules? | **Today: barely.** External contributors face a missing LICENSE, no plugin guide, no scaffolding, an inline-hardcoded registry, closed unions, and incorrect onboarding docs. |
| Is the codebase ready for out-of-tree plugins (future B)? | **No.** `dependencies` instead of `peerDependencies`, closed `Capability`/`EntityType` unions in code (despite docs intending openness), deep-path imports, no manifest discovery, no SDK package, no plugin-owned-migration path. |
| Is the FE ready for plugin-contributed components? | **No.** Centralized eager router, closed `ApiClient` interface, marketplace-specific UI in `shared/`, `Connection.platformType` closed union dispatched via literal-equality across a dozen call sites. |

**Overall posture**: One focused milestone (~2 weeks of focused docs work) brings (a) to a ship-able state. A second milestone (~3–6 weeks) makes in-tree contribution clean. A third (post-v1.0) makes (b) reachable. The architectural ambition stated in `docs/architecture-overview.md` is well-founded; this review is about closing the gap between intent and surface.

---

## Priority Threads

> **Cross-cutting anti-pattern: literal-equality dispatch on `platformType`.**
> Findings BE-9, D3, D4, E2, E5 — and parts of BE-7, BE-11, BE-12 — are all instances of the same shape: core or generic code does `if (connection.platformType === 'allegro') { ... }` (or `=== 'prestashop'`, or `Record<PlatformType, T>` patterns enforced at compile time against the closed union). Plugin authors cannot dispatch into core without editing core.
>
> **Recommended cross-cutting fix**: a single ESLint `no-restricted-syntax` rule banning `BinaryExpression[operator='==='][left.property.name='platformType']` outside `libs/integrations/<x>/`, paired with a `dispatchByPlatformType<T>(connection, registry: Map<string, T>)` helper for the legitimate "look up a per-platform handler" case. Add the rule once existing instances are removed; fight the anti-pattern at the lint layer instead of one-by-one as it reappears.

The 58 findings cluster into 8 priority threads. Each thread is a candidate **milestone** (or parent issue); each finding within is a child issue. Order roughly reflects what unblocks the most contributors fastest.

### Thread A — Unblock OSS contribution (legal & first impression)

A first-time external contributor cannot legally contribute, cannot tell which org owns the repo, and sees three top-level `ISSUE_*.md` planning files alongside the README before they see a LICENSE.

- A1 [BLOCKER] No LICENSE file — `README.md:184` says `[Add your license here]`; no `LICENSE`/`COPYING` at root.
- A2 [HIGH] Three different repository URLs across `README.md:28`, `CONTRIBUTING.md:16`, `.github/ISSUE_TEMPLATE/config.yml:4,7`.
- A3 [HIGH] CI uses `self-hosted` runners (`.github/workflows/ci.yml:14,41,58,86,155`) — fork PRs from external contributors will not run lint/test/build by GitHub default policy.
- A4 [MEDIUM] No `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`. SECURITY is most critical — this platform handles OAuth tokens and customer PII.
- A5 [MEDIUM] Six top-level `ISSUE_*.md` planning files at the repo root read as cruft to a stranger.
- A6 [LOW] Empty `.md` file at the repo root (zero bytes).
- A7 [LOW] README §License is a literal `[Add your license here]` placeholder.

**Ship goal**: A stranger cloning the repo can legally contribute and gets a clean first impression.

### Thread B — Plugin author guide & scaffolding (in-tree contribution path)

There is no doc that walks a contributor from "I want to add Platform X" to "PR opened." The closest material is a 15-line `connections-and-adapter-resolution.md` snippet showing how to add a row to an in-memory map.

- B1 [BLOCKER] No "Building a plugin / Adding a new integration" guide. The closest is `docs/connections-and-adapter-resolution.md:167-184` — covers registry-row insertion only.
- B2 [BLOCKER] No reference adapter signposted. Three integrations exist (`prestashop`, `allegro`, `ai`) and no doc says which to copy.
- B3 [HIGH] No scaffolding/generator. `scripts/` has invariant-checkers only; no `pnpm create-adapter`, no Nest schematic.
- B4 [HIGH] CONTRIBUTING.md is incomplete and wrong: placeholder URL `your-org/openlinker.git`, `develop` as base branch (should be `main`), wrong migration command (`pnpm migration:run` instead of `pnpm --filter @openlinker/api migration:run`), incomplete dev-stack startup, no mention of `Closes #N` or branch-naming conventions documented in `CLAUDE.md`.
- B5 [HIGH] No PR template (`.github/pull_request_template.md` does not exist).
- B6 [HIGH] No "Add a new integration" issue template — the existing six templates do not cover platform-specific shape (capability matrix, auth model, rate limits).
- B7 [HIGH] No CODEOWNERS, no GOVERNANCE.md — contributors don't know whose review to request or who can merge.
- B8 [MEDIUM] `docs/getting-started.md:5,239,243` is marked WIP with §§ 8-9 (first offer / first order end-to-end) as `_TBD_`; the proof-the-platform-works happy-path is undocumented.

**Ship goal**: A stranger can go from "I want to add Platform X" → "PR opened" with confidence.

### Thread C — Make the adapter registry actually pluggable

The very thing that should let plugins drop in (the registry) is a hardcoded inline `Map` that knows about exactly two platforms. Note: a *parallel* registry (`AdapterFactoryResolverService`) already supports `registerFactory` — the fix is to make both consistent, not to invent a new one.

- C1 [BLOCKER] Adapter metadata registry hardcoded inline at `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts:25-47`. No `register()` method exists; `AdapterRegistryPort` exposes only read operations. The sibling `AdapterFactoryResolverService` already exposes `registerFactory()` — the asymmetry is the bug.
- C2 [BLOCKER] `IntegrationsService.deriveAdapterKey` carries an inline `Record<string, string>` mapping `'prestashop' → 'prestashop.webservice.v1'`, `'allegro' → 'allegro.publicapi.v1'` (`libs/core/src/integrations/application/services/integrations.service.ts:301-315`).
- C3 [HIGH] `apps/api` and `apps/worker` static-import every integration by name (`apps/api/src/integrations/integrations.module.ts:14-34`; `apps/worker/src/sync/sync-worker.module.ts:17,45`). No manifest scan, no `forRoot({ plugins: [...] })`.
- C4 [MEDIUM] `AdapterFactoryPort.createCapabilityAdapter` uses `as unknown as T` casts in both adapter wrappers (`libs/integrations/allegro/src/infrastructure/adapters/allegro-adapter-factory-wrapper.ts:48-73`, `prestashop-adapter-factory-wrapper.ts:50-86`).
- C5 [LOW] `AdapterRegistryService.getAdapter` returns a placeholder `unknown` object (`adapter-registry.service.ts:49-53`).
- C6 [LOW] Adapter manifest is registered imperatively, no static export.

**Ship goal**: A new platform can register itself at `onModuleInit` with `register({ adapterKey, platformType, supportedCapabilities, displayName, version })` — without touching `libs/core` or `apps/api`.

### Thread D — Open up the closed unions (extension axes)

Five closed `as const` unions in core encode the assumption "OpenLinker will only ever support these platforms / capabilities / entity types." Two of them (D1, D2) are **regressions against the architecture doc's documented contract** — the docs already state these should be open.

- D1 [BLOCKER] `Capability` is a closed union of 5 values at `libs/core/src/integrations/domain/types/adapter.types.ts:18-33`. **Doc-vs-code drift**: `architecture-overview.md:478-480` documents `PricingAuthorityPort`, `ShippingProviderManagerPort`, `PaymentProcessorPort` as future capabilities — but the closed union forces a core PR for each. **Fix**: treat `Capability` as `string` at registry boundary; keep `CoreCapabilityValues` as published well-known set.
- D2 [BLOCKER] `EntityType` is a closed union of 7 values at `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts:9-19`. **Doc-vs-code drift**: `architecture-overview.md:528-533` documents the port signature as `entityType: 'Product' | 'Order' | 'Offer' | 'Inventory' | 'Customer' | string` — the architectural contract already supports plugin extension; the code regressed against it. **Fix is mechanical**: align code to the documented contract.
- D3 [HIGH] FE `PLATFORM_TYPES` closed union at `apps/web/src/features/connections/api/connections.types.ts:1-3`. Platform-picker uses `Record<PlatformType, ...>` (`apps/web/src/features/connections/components/platform-picker.tsx:21-36`) — compiler-enforces exhaustiveness against the closed set.
- D4 [HIGH] Platform-specific UI dispatch via `=== 'allegro'` literals across a dozen call sites (`CreateOfferWizard.tsx:302`, `EditConnectionForm.tsx:162,185,345,433`, `ConnectionActionsPanel.tsx:26`, `listing-detail-page.tsx:119`). Same anti-pattern as the cross-cutting box above.
- D5 [MEDIUM] `PromptTemplateChannelValues = ['prestashop', 'allegro'] as const` at `libs/core/src/ai/domain/types/prompt-template.types.ts:25`.

**Ship goal**: `Capability`, `EntityType`, `platformType` become open-world strings with documented "well-known" sets. Adding a platform/capability/entity-type doesn't require editing `libs/core`.

### Thread E — Remove platform-specific knowledge from core orchestration

Core orchestration code repeatedly bends around specific platforms — and `apps/worker` (a generic runner) takes a hard dependency on `@openlinker/integrations-allegro`.

- E1 [HIGH] Generic `SyncJobRunner` imports `AllegroApiException` and `AllegroAuthenticationException` from `@openlinker/integrations-allegro` to classify retryability (`apps/worker/src/sync/sync-job.runner.ts:19-30, 352-378`). Architecturally inverted dependency.
- E2 [HIGH] `inventory.propagateToMarketplaces` handler filters mappings to `m.platformType === 'allegro'` (`apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:108-117`). Non-Allegro inventory is silently dropped.
- E3 [HIGH] `ConnectionController.installWebhooks` injects `IPrestashopWebhookProvisioningService` from `@openlinker/integrations-prestashop` (`apps/api/src/integrations/http/connection.controller.ts:32-35,63-64,264-269`).
- E4 [HIGH] `SchedulerService` hardcodes Allegro-specific cron tasks and cursor keys (`apps/api/src/sync/application/services/scheduler.service.ts:140-200`).
- E5 [HIGH] `CustomerIdentityResolverService` hardcodes `normalizeEmail(email, 'allegro')` and `hashEmail(email, 'allegro')` (`libs/core/src/customers/application/services/customer-identity-resolver.service.ts:135-136, 246-247`). Allegro masked-email handling lives in core, not in the source adapter.
- E6 [MEDIUM] `validateCredentialsShape` and `CONNECTION_CONFIG_VALIDATORS` use `if (platformType === 'prestashop')` branches and a hardcoded `Record` keyed by platform (`apps/api/src/integrations/application/credentials/credential-shape.validator.ts:17`, `connection-config-validators.ts:62-65`).
- E7 [MEDIUM] `Connection.config` typed as `Record<string, any>` — per-platform shape erased at the controller boundary; revalidation is bolted on after the fact (`apps/api/src/integrations/application/services/connection.service.ts:115-125, 275-289`). **Note**: this is currently the *documented* design (`architecture-overview.md:507, 1141`); the `any` itself violates `engineering-standards.md:1106` (§Type Safety: "Avoid `any` type"). **Fix and update the architecture doc together.**

**Ship goal**: Core orchestration is platform-agnostic. Platform-specific behaviour (retry classification, webhook provisioning, cron tasks, email normalization, config validation) is contributed by adapters via narrow capability ports.

### Thread F — Establish the SDK boundary (preparation for npm publishing)

Today plugin authors reverse-engineer "what's public" by reading `libs/integrations/allegro` imports. This is fine in-tree but commits the project to a sprawling backwards-compat liability the moment anything is published.

- F1 [BLOCKER] `@openlinker/core` and `@openlinker/shared` declare `@nestjs/common@10.3.0`, `@nestjs/typeorm`, `typeorm` as `dependencies`, not `peerDependencies` (`libs/core/package.json:145-149`, `libs/shared/package.json:52-57`). When a plugin installs from npm, two copies of `@nestjs/common` will coexist; NestJS DI metadata reflection breaks across copies.
- F2 [HIGH] `@openlinker/shared` `Logger` directly extends `@nestjs/common` Logger (`libs/shared/src/logging/logger.ts:10-16`). **Note**: this is currently the *documented standard* (`architecture-overview.md:1452` §Technology Stack and `engineering-standards.md:1023-1030` §Logging). Adapters value-import `Logger`, transitively dragging `@nestjs/common` in — defeating peer-dep isolation. **Fix and update both doc sections together.**
- F3 [HIGH] Top-level core barrel omits `ai` and `content` bounded contexts (`libs/core/src/index.ts:9-20` — 12 contexts, missing `./ai` and `./content`). The AI integration uses 12+ deep-path imports as a result.
- F4 [HIGH] `Connection` exposed via both barrel (`@openlinker/core/identifier-mapping`) and deep path. The package.json `exports` field permits the deep path via wildcard subpaths.
- F5 [HIGH] `AdapterFactoryPort` itself imports `Connection` via the deep path — the most important interface a plugin author implements teaches them deep paths are acceptable (`libs/core/src/integrations/domain/ports/adapter-factory.port.ts:9-10`).
- F6 [HIGH] Adapter modules require host to wire NestJS, TypeORM, ConfigService, Redis, six Symbol tokens — there is no zero-config path. `AdapterMetadata` is declared in code at registration, not as a static manifest export.
- F7 [MEDIUM] ORM entities are exported from public barrels (`products/index.ts:62-64`, `inventory/index.ts:54-55`, `orders/index.ts:101-102`, plus 5 more).
- F8 [MEDIUM] Symbol DI tokens are inconsistently re-exported. `users/index.ts:17-21` re-exports from `users.module.ts`; `products/index.ts:14-20` cherry-picks from `products.tokens.ts`.
- F9 [MEDIUM] All packages pinned at `0.1.0`, `private: true`, no Changesets, no CHANGELOG, no `engines` field, no semver discipline.
- F10 [MEDIUM] No dedicated `@openlinker/plugin-sdk` package.
- F11 [LOW] `import type` is used inconsistently (~17% of core, ~7% of adapters).
- F12 [HIGH] **Plugin-owned migrations have no shipping path** — `migrations.md:21` states "**`apps/api` owns the database schema**, even though ORM entities live in `libs/core`." A plugin shipping its own ORM entities (e.g., a `Refund` for Shopify, a `Subscription` for a future platform) has no place to put migrations — even in-tree. **Fix**: per-plugin `migrations` glob in the plugin manifest; host data-source aggregates `[...coreMigrations, ...plugins.flatMap(p => p.migrations ?? [])]` at boot. **Doc to update**: `migrations.md` §Architecture (scope "apps/api owns the schema" to "apps/api owns the *core* schema, plugins own theirs").

**Ship goal**: A future `@openlinker/plugin-sdk` package has a clear, narrow, semver'd surface. Framework-coupling is moved behind ports. Plugins can publish their own ORM entities + migrations.

### Thread G — Test kit for plugin authors

Every adapter spec hand-rolls its own mocks of `IdentifierMappingPort`, `CredentialsResolverPort`, etc. The Testcontainers harness exists but lives in `apps/api` and is not exported.

- G1 [HIGH] Test harness (`getTestHarness`, `resetTestHarness`, PrestaShop Testcontainer helper) lives in `apps/api/test/integration/`, not exported as a reusable package. Plugin authors writing `libs/integrations/<x>/test/integration/` cannot import it. *(This finding absorbs the formerly-separate "DX-9 Test harness not exposed for plugin reuse" — same finding viewed from BE-architecture vs DX angles.)*
- G2 [MEDIUM] No published in-memory fakes for `IdentifierMappingPort`, `CredentialsResolverPort`, `CachePort`, `EventPublisherPort`. Only `FakeAiCompletionAdapter` exists, scoped to one package.
- G3 [MEDIUM] CI hardcodes adapter package builds (`.github/workflows/ci.yml:74-78, 107-110`).
- G4 [LOW] FE test harness `DeepPartialApiClient` mirrors the closed `ApiClient` interface (`apps/web/src/test/test-utils.tsx:38-57`). Once `ApiClient` opens (Thread H), the harness must follow.

**Ship goal**: Plugin authors can write meaningful unit + integration tests by importing `@openlinker/test-utils` (or `@openlinker/core/<context>/testing`) — no copy-paste required.

### Thread H — FE plugin architecture (extension points)

The FE is clean as a monolith but has zero plugin extension points. Marketplace-specific UI is woven into core; routes, nav, breadcrumbs, and the typed `ApiClient` are all closed surfaces.

- H1 [BLOCKER] No plugin/extension/slot/registry abstraction anywhere in `apps/web/src`. Confirmed by full-tree grep.
- H2 [BLOCKER] Typed `ApiClient` is a closed interface listing every feature by name (`apps/web/src/app/api/api-client.ts:39-58`). 18 namespaces.
- H3 [HIGH] Routes are centralized and eagerly imported (`apps/web/src/app/router.tsx:1-13`, `app/routes/root.route.tsx:32-63`). 24 hardcoded children, no React Router `lazy` field. *(Note: `frontend-architecture.md:56-72` documents centralized routing as intentional. The gaps are eager imports + no contribution mechanism — centralization itself is fine.)*
- H4 [HIGH] `shared/` contains marketplace-specific code violating the documented "shared must stay domain-agnostic" rule (`docs/frontend-architecture.md:52`). Files: `shared/ui/allegro-error-list.tsx`, `shared/lib/allegro-error-mapping.ts`, `shared/ui/category-tree-browser.tsx` (Allegro-shaped consumer).
- H5 [HIGH] `CreateOfferWizard.tsx` (1062 lines) is presented as generic but is wired to Allegro semantics throughout (Allegro categories, seller policies, `productSet` parameter sections, `serializeAllegroParameters`). The most plugin-shaped UI surface is the most tightly bound.
- H6 [HIGH] Cross-feature deep imports give plugins no way to "own" a vertical slice. No `features/<x>/index.ts` barrels exist.
- H7 [MEDIUM] Navigation, breadcrumbs, route metadata hardcoded in `app-shell.tsx:76-132, 134-154, 156-170`. Marketplace-specific URLs (`/connections/new/allegro`) live in core chrome.
- H8 [MEDIUM] No design-token export for plugin authors. Tokens live as 6585 lines of CSS custom properties in `apps/web/src/index.css`; no JS/TS export, no Storybook, no `shared/ui/index.ts` catalog.
- H9 [HIGH] **No i18n infrastructure** — every label is a hardcoded English string; `Intl.NumberFormat('en-US')` hardcoded in `app-shell.tsx:172`. *Promoted from MEDIUM*: shipping without an i18n seam means every string in the codebase has to be migrated when the seam arrives. Adding a no-op `t(key, fallback)` + `LocaleProvider` returning the fallback is a 1-day fix; retrofitting later is a 1-month fix.
- H10 [LOW] Content feature carries Allegro semantics by name (`features/content/lib/extract-allegro-errors.ts`, `features/content/api/content.utils.ts`).

**Ship goal**: A third-party plugin can register routes, nav items, wizards, an API namespace, and error renderers via a typed `definePlugin({...})` collected from a `plugins/index.ts` barrel — without forking core.

---

## Sequenced Roadmap

The 8 priority threads naturally split into 3 milestones. Each milestone is independently shippable and unblocks a specific cohort of contributors.

**Effort key**: S = ≤1 day · M = 1–3 days · L = 3–10 days · XL = >10 days. Estimates assume one engineer focused on the milestone.

### Milestone 1 — "An external contributor can land a PR" (~2 weeks; mostly docs)

Smallest set of changes that makes external OSS contribution legally and practically possible. **All of Thread A and Thread B.**

- (S) Add `LICENSE` (Apache-2.0 recommended), update `package.json` `license` field, fix `README.md:184`.
- (S) Add `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`.
- (S) Pick one canonical repo URL; replace all hardcoded references. Move to `package.json#repository`.
- (S) Switch CI default `runs-on` to `ubuntu-latest` (or also run on `ubuntu-latest` for `pull_request` events from forks).
- (S) Move top-level `ISSUE_*.md` files to `docs/plans/legacy/` or delete; remove the empty `.md` file.
- (M) Rewrite `CONTRIBUTING.md`: real URL, base branch `main`, link to `docs/getting-started.md`, document `Closes #N` and `{issue-number}-{kebab-description}` branch naming, document `pnpm lint && pnpm type-check && pnpm test` quality gate.
- (S) Add `.github/pull_request_template.md` with a checklist.
- (S) Add `.github/ISSUE_TEMPLATE/new_integration.md`.
- (S) Add `.github/CODEOWNERS` mapping `libs/integrations/<x>/` to maintainers and `libs/core/`, `apps/api/` to the core team.
- (S) Designate `libs/integrations/prestashop/` as the reference adapter; add a one-paragraph README; cross-link from `CONTRIBUTING.md` and `docs/architecture-overview.md`.
- (L) Write `docs/plugin-author-guide.md` covering port selection, package layout, factory wiring, credentials/OAuth, capability declaration, testing.
- (M) Add `scripts/create-adapter.mjs` (Stage 1) — copy `libs/integrations/prestashop/` skeleton with token replacement.
- (M) Complete or trim `docs/getting-started.md` §§ 8-9.

**Exit criteria**: A stranger can clone, run the stack, copy the reference adapter via the script, follow the plugin guide, open a PR, get CI signal, and have a clear reviewer.

### Milestone 2 — "In-tree plugins are clean to add" (~3–6 weeks)

Removes the architectural friction that makes in-tree contribution painful. **Threads C, D, E, plus G1, plus the cross-cutting platformType lint.**

- (M) **C1**: Add `AdapterRegistryService.register(metadata)`; drop the inline `Map`. Mirrors existing `AdapterFactoryResolverService.registerFactory`.
- (S) **C2**: Move default-key registration onto the registry (`isDefault: true` flag). Delete `deriveAdapterKey`.
- (L) **C3**: Introduce `PluginRegistryModule.forRoot({ plugins: [...] })`. Keep static imports as the dev/test fast-path.
- (M) **C4**: Provide a typed `BaseAdapterFactory<CapabilityMap>` helper.
- (S) **D1, D2, D5**: Widen `Capability`, `EntityType`, `PromptTemplateChannel` to `string` at the port boundary. Closes the doc-vs-code drift.
- (M) **D3, D4**: Treat FE `platformType` as opaque string. Replace `Record<PlatformType, ...>` patterns with `Map<string, T>` lookups. Delete `=== 'allegro'` literals.
- (M) **E1**: Define `RetryClassificationPort`. Drop `apps/worker/src/sync/sync-job.runner.ts` import of `@openlinker/integrations-allegro`.
- (S) **E2**: Drop the `=== 'allegro'` filter in the inventory propagation handler.
- (M) **E3**: Define `WebhookProvisioningPort` capability; route by `connection.platformType` from a registry. Mirrors the existing `ConnectionTesterRegistryService` pattern.
- (M) **E4**: Expose `SchedulerService.registerTask`. Each integration registers its own cron tasks at `onModuleInit`.
- (S) **E5**: Add an `EmailNormalizer` capability on `OrderSourcePort`. Move Allegro masked-email logic into the Allegro adapter.
- (M) **E6, E7**: Promote `validateCredentialsShape` and `CONNECTION_CONFIG_VALIDATORS` to a registry. Update `architecture-overview.md` `Connection.config` typing in the same PR.
- (M) **G1**: Extract `apps/api/test/integration/setup.ts` + `prestashop-container.helper.ts` into `libs/test-utils`. Add a "Testing your adapter" section to the plugin guide.
- (S) **Cross-cutting**: Add ESLint `no-restricted-syntax` rule banning `BinaryExpression[operator='==='][left.property.name='platformType']` outside `libs/integrations/<x>/`.

**Exit criteria**: Adding a new platform requires exactly one PR, all of which lives under `libs/integrations/<new-platform>/`. No edits to `libs/core/`, `apps/api/`, or `apps/worker/` are required for a typical adapter.

### Milestone 3 — "Out-of-tree plugins are reachable" (later, post-v1.0)

Closes the gap to npm-published plugins. **Thread F (most), Thread G (rest), Thread H.**

- (S) **F1**: Move `@nestjs/common`, `@nestjs/typeorm`, `@nestjs/config`, `typeorm` to `peerDependencies`. Add `engines` field.
- (M) **F2**: Define `LoggerPort`. Update `architecture-overview.md` §Technology Stack and `engineering-standards.md` §Logging.
- (S) **F3**: Add `export * from './ai'` and `export * from './content'`.
- (M) **F4, F5**: Tighten `package.json` `exports` to drop wildcard subpaths. Add ESLint `no-restricted-imports` rule. Fix `adapter-factory.port.ts:9-10`.
- (XL) **F6**: Define `AdapterPlugin` interface (static `manifest`, typed `register(host)`, `createCapabilityAdapter`). Provide `createNestAdapterModule(plugin)` helper.
- (M) **F7**: Move ORM-entity exports to `<context>/orm-entities` subpath.
- (S) **F8**: Standardise on `export * from './<name>.tokens'`.
- (M) **F9**: Adopt Changesets. `PUBLIC_API.md`. `0.1.0-rc.1` first cut.
- (L) **F10**: Extract `@openlinker/plugin-sdk`.
- (M) **F11**: Enable `@typescript-eslint/consistent-type-imports`. Barrel-purity tests for every bounded context.
- (L) **F12**: Plugin-owned migrations — manifest `migrations` glob; host aggregates. Update `migrations.md`.
- (M) **G2, G3**: Publish in-memory fakes under `<context>/testing` subpaths. Replace CI's hardcoded build list with `pnpm -r --filter "./libs/**" build`.
- (S) **G4**: Open the FE test harness once `ApiClient` opens.
- (XL) **H1, H2**: `PluginRegistry` shape with extension points (routes, navItems, connectionSetupWizards, offerCreationWizards, connectionConfigSections, apiClientNamespaces). Build-time, statically collected from `plugins/index.ts` barrel.
- (L) **H3**: Adopt React Router `lazy` field on every route; switch `rootRoute.children` to `[...coreRoutes, ...plugins.flatMap(p => p.routes ?? [])]`. Move marketplace-specific routes into their feature slices.
- (M) **H4**: Rename `AllegroErrorList` → `StructuredErrorList` accepting generic `{ field?, code, message }[]`. Move Allegro mapping into `features/allegro/lib/`. Add ESLint boundary for `shared/`.
- (XL) **H5**: `OfferCreationWizard` extension point keyed by `platformType`. Rename current wizard to `AllegroCreateOfferWizard` and move under `features/allegro/`. Generalize stepper chrome into `WizardDialog`.
- (M) **H6**: Add `features/<x>/index.ts` public barrels. ESLint enforcement.
- (M) **H7**: Move nav/breadcrumb registration into `NavigationRegistry`. Colocate route breadcrumb metadata via `route.handle`.
- (M) **H8**: Export tokens as typed object (`shared/theme/tokens.ts`) with parity script. Add `shared/ui/index.ts` catalog.
- (M) **H9**: Ship a no-op `t(key, fallback)` helper + `LocaleProvider`.
- (S) **H10**: Generalize `extract-allegro-errors.ts` → `extract-platform-errors.ts` with a registry.

**Exit criteria**: A third party can publish `@third-party/openlinker-plugin-shopify` to npm, the host installs it, the manifest is read at boot, the plugin self-registers BE adapter capabilities and FE routes/wizards/api-client namespace, and core code has no knowledge of Shopify.

---

## Findings Catalog

The full set of 58 findings, grouped by audit area. Severity rubric:
- **BLOCKER**: out-of-tree plugins are flat-out impossible without fixing this, OR external contribution is legally/practically impossible.
- **HIGH**: in-tree contribution is painful, or out-of-tree will require breaking changes.
- **MEDIUM**: real friction but workaroundable.
- **LOW**: polish.

> Each finding below is shaped to be filed 1:1 as a GitHub issue. Severity tags map to issue labels (BLOCKER + HIGH → 🔴 Blocking; MEDIUM → 🟡; LOW → 🟢, per `code-review-guide.md:251-277`).

### Backend plugin architecture (15 findings)

- **[BLOCKER] BE-1: Adapter metadata registry is a hardcoded in-memory map** — `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts:25-47`. No `register()`, only read methods. The sibling `AdapterFactoryResolverService` already supports `registerFactory()` — the asymmetry between the two registries is the bug. **Fix**: add `register(metadata)`; drop the inline literal; integration modules self-register at `onModuleInit`.
- **[BLOCKER] BE-2: `platformType → adapterKey` mapping hardcoded inline** — `libs/core/src/integrations/application/services/integrations.service.ts:301-315`. **Fix**: move default-key registration onto the registry; delete `deriveAdapterKey`.
- **[BLOCKER] BE-3: `Capability` is a closed `as const` union despite documented future-capability list** — `libs/core/src/integrations/domain/types/adapter.types.ts:18-33`. **Doc-vs-code drift**: `architecture-overview.md:478-480` documents `PricingAuthorityPort`, `ShippingProviderManagerPort`, `PaymentProcessorPort` as future capabilities. **Fix**: treat `Capability` as `string` at registry boundary; keep well-known set as `CoreCapabilityValues`.
- **[HIGH] BE-4: API and worker static-import every integration by name** — `apps/api/src/integrations/integrations.module.ts:14-34`, `apps/worker/src/sync/sync-worker.module.ts:17,45`. **Fix**: `PluginRegistryModule.forRoot({ plugins })` + manifest discovery.
- **[HIGH] BE-5: `SyncJobRunner` imports platform-specific exceptions** — `apps/worker/src/sync/sync-job.runner.ts:19-30, 352-378`. **Fix**: neutral `RetryClassificationPort`; integrations register their own classification.
- **[HIGH] BE-6: `inventory.propagateToMarketplaces` filters `=== 'allegro'`** — `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:108-117`. **Fix**: drop the filter; per-platform behaviour belongs in the adapter.
- **[HIGH] BE-7: `ConnectionController.installWebhooks` injects PrestaShop-specific service** — `apps/api/src/integrations/http/connection.controller.ts:32-35,63-64,264-269`. **Fix**: define `WebhookProvisioningPort`; route by `connection.platformType` from a registry.
- **[HIGH] BE-8: `SchedulerService` hardcodes Allegro cron tasks** — `apps/api/src/sync/application/services/scheduler.service.ts:140-200`. **Fix**: expose `registerTask`; integrations register at `onModuleInit`.
- **[HIGH] BE-9: `CustomerIdentityResolverService` hardcodes Allegro email normalization** — `libs/core/src/customers/application/services/customer-identity-resolver.service.ts:135-136, 246-247`. **Fix**: `EmailNormalizer` capability on source adapter.
- **[MEDIUM] BE-10: Hardcoded platform strings in core types** — `libs/core/src/ai/domain/types/prompt-template.types.ts:25`, `libs/core/src/listings/domain/types/offer-mapping.types.ts:19`. **Fix**: replace closed channel union with `string`.
- **[MEDIUM] BE-11: `validateCredentialsShape` and `CONNECTION_CONFIG_VALIDATORS` platform-switched** — `apps/api/src/integrations/application/credentials/credential-shape.validator.ts:17`, `connection-config-validators.ts:62-65`. **Fix**: registry populated by integration modules.
- **[MEDIUM] BE-12: `Connection.config` typed as `Record<string, any>` — currently the documented design** — `apps/api/src/integrations/application/services/connection.service.ts:115-125, 275-289`. **Note**: `architecture-overview.md:507, 1141` documents this shape; the `any` itself violates `engineering-standards.md:1106` (§Type Safety: "Avoid `any` type") — the docs are internally inconsistent. **Fix**: discriminated DTO or registry-driven JSON-Schema. **Doc to update**: `architecture-overview.md` §Connection Entity (replace `Record<string, any>` with `Record<string, unknown>` and require per-plugin schema registration).
- **[MEDIUM] BE-13: `AdapterFactoryPort.createCapabilityAdapter` uses `as unknown as T`** — both wrapper files (`allegro-adapter-factory-wrapper.ts:48-73`, `prestashop-adapter-factory-wrapper.ts:50-86`). **Fix**: `BaseAdapterFactory` SDK helper with proper narrowing.
- **[MEDIUM] BE-14: No dedicated `@openlinker/plugin-sdk` package** — plugin authors face a maze of barrels. **Fix**: extract curated SDK; semver independently.
- **[LOW] BE-15: `AdapterRegistryService.getAdapter` returns placeholder `unknown`** — `adapter-registry.service.ts:49-53`. **Fix**: delete placeholder branch; throw on missing factory.

### Frontend plugin architecture (12 findings)

- **[BLOCKER] FE-1: No plugin/extension registry exists** — confirmed by full-tree grep. **Fix**: introduce `PluginRegistry` with build-time `definePlugin({...})` extension points.
- **[BLOCKER] FE-2: Typed `ApiClient` is a closed enum** — `apps/web/src/app/api/api-client.ts:39-58`. **Fix**: split base + extension mechanism.
- **[HIGH] FE-3: Routes centralized and eagerly imported** — `apps/web/src/app/router.tsx:1-13`, `app/routes/root.route.tsx:32-63`. *(Centralization is documented in `frontend-architecture.md:56-72` as intentional; the gaps are eager imports + no contribution mechanism.)* **Fix**: React Router `lazy` field; `rootRoute.children` composed from plugins.
- **[HIGH] FE-4: `shared/` contains marketplace-specific code** — `shared/ui/allegro-error-list.tsx`, `shared/lib/allegro-error-mapping.ts`, `shared/ui/category-tree-browser.tsx`. Violates `frontend-architecture.md:52`. **Fix**: rename + relocate; ESLint boundary rule.
- **[HIGH] FE-5: `Connection.platformType` closed union; literal-equality dispatch** — `apps/web/src/features/connections/api/connections.types.ts:1-3` plus a dozen call sites. **Fix**: opaque `string` + capability-based dispatch + per-plugin component registry.
- **[HIGH] FE-6: `CreateOfferWizard` is Allegro-shaped, not capability-shaped** — `features/listings/components/CreateOfferWizard.tsx:74-80, 493-513, 911-965, 780-813`. **Fix**: extension point keyed by `platformType`; rename current wizard to `AllegroCreateOfferWizard`.
- **[HIGH] FE-7: Cross-feature imports give plugins no way to own a vertical slice** — multiple call sites; no `features/<x>/index.ts` barrels exist. **Fix**: per-feature public barrels + ESLint enforcement.
- **[MEDIUM] FE-8: Navigation, breadcrumbs, route metadata hardcoded** — `app-shell.tsx:76-132, 134-154, 156-170`. **Fix**: `NavigationRegistry`; colocate breadcrumb metadata via `route.handle`.
- **[MEDIUM] FE-9: No design-token export for plugin authors** — tokens live in 6585-line `index.css`. **Fix**: typed `tokens.ts` with parity script; `shared/ui/index.ts` catalog; Storybook.
- **[HIGH] FE-10: No i18n infrastructure** *(promoted from MEDIUM)* — `Intl.NumberFormat('en-US')` hardcoded at `app-shell.tsx:172`, no `useTranslation`. Shipping without an i18n seam means every string in the codebase has to be migrated when the seam arrives — adding it now is a 1-day fix; retrofitting later is a 1-month fix. **Fix**: ship a no-op `t(key, fallback)` + `LocaleProvider` returning fallback now; defer real translations.
- **[LOW] FE-11: Test harness closed over monolithic `ApiClient`** — `apps/web/src/test/test-utils.tsx:38-57`. **Fix**: open once `ApiClient` opens; extract as `@openlinker/web-test-utils`.
- **[LOW] FE-12: Content feature carries Allegro semantics by name** — `features/content/lib/extract-allegro-errors.ts`, `features/content/api/content.utils.ts`. **Fix**: registry of platform-specific extractors.

### Public API / SDK readiness (14 findings)

- **[BLOCKER] SDK-1: Core declares NestJS/TypeORM as `dependencies`, not `peerDependencies`** — `libs/core/package.json:145-149`, `libs/shared/package.json:52-57`. **Fix**: move to `peerDependencies` with caret ranges; add `engines`.
- **[BLOCKER] SDK-2: `EntityType` is closed in code despite documented contract being open** — `libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts:9-19`. **Doc-vs-code drift**: `architecture-overview.md:528-533` documents the port signature as `entityType: 'Product' | 'Order' | 'Offer' | 'Inventory' | 'Customer' | string` — the architectural contract already supports plugin extension; the code regressed against it. **Fix**: align code to the documented contract — widen parameter to `EntityType | string`. No design change needed.
- **[HIGH] SDK-3: Top-level core barrel omits `ai` and `content`** — `libs/core/src/index.ts:9-20`. **Fix**: add the missing exports; refactor AI integration to value-import from sub-barrel.
- **[HIGH] SDK-4: `Logger` extends NestJS Logger — Nest-coupling is the documented standard, must be revisited for OSS** — `libs/shared/src/logging/logger.ts:10-16`. Currently enshrined by `architecture-overview.md:1452` and `engineering-standards.md:1023-1030`. **Fix**: define neutral `LoggerPort`; default Nest-backed impl on a separate subpath. **Docs to update**: both Logging sections must point at the port.
- **[HIGH] SDK-5: `Connection` exposed via barrel and deep path** — both shapes appear in adapter code; package.json wildcard subpaths permit it. **Fix**: drop wildcard subpaths from `exports`; ESLint `no-restricted-imports` rule.
- **[HIGH] SDK-6: `AdapterFactoryPort` itself uses deep cross-context import** — `libs/core/src/integrations/domain/ports/adapter-factory.port.ts:9-10`. **Fix**: import `Connection` from `@openlinker/core/identifier-mapping`; barrel-only-imports lint for `domain/ports/*.port.ts`.
- **[HIGH] SDK-7: Adapter modules require host to wire NestJS, TypeORM, ConfigService** — `libs/integrations/allegro/src/allegro-integration.module.ts:10-90`. **Fix**: `AdapterPlugin` interface with static manifest, typed `register(host)`, `createCapabilityAdapter`; `createNestAdapterModule(plugin)` helper.
- **[HIGH] SDK-14: Plugin-owned migrations have no shipping path** — `migrations.md:21` states `apps/api` owns the database schema. A plugin with its own ORM entities (e.g., a `Refund` for Shopify, a `Subscription` for a future platform) cannot ship migrations alongside its package — even in-tree, plugin migrations land in `apps/api/src/migrations/` mixed with core. **Fix**: per-plugin `migrations` glob in the plugin manifest; host data-source aggregates `[...coreMigrations, ...plugins.flatMap(p => p.migrations ?? [])]` at boot. Test isolation: plugin-owned migrations must run in plugin-scoped transactions during `pnpm test:integration` setup. **Doc to update**: `migrations.md` §Architecture (scope "apps/api owns the schema" to "apps/api owns the *core* schema, plugins own theirs").
- **[MEDIUM] SDK-8: No test kit / in-memory fakes published** — `libs/core` and `libs/shared` have no `fakes/` or `testing/` subpath. **Fix**: ship `<context>/testing` subpaths with in-memory implementations.
- **[MEDIUM] SDK-9: All packages pinned `0.1.0`, no semver discipline** — no Changesets, CHANGELOG, `engines`, or `publishConfig`. **Fix**: adopt Changesets; `PUBLIC_API.md` contract; `0.1.0-rc.1` first cut.
- **[MEDIUM] SDK-10: Symbol DI tokens inconsistently re-exported** — `users/index.ts:17-21` vs `products/index.ts:14-20`. **Fix**: standardize on `export * from './<name>.tokens'`; lint rule.
- **[MEDIUM] SDK-11: ORM entities exported from public barrels** — `products/index.ts:62-64`, `inventory/index.ts:54-55`, `orders/index.ts:101-102`, plus 5 more. **Fix**: move to `<context>/orm-entities` subpath.
- **[LOW] SDK-12: `import type` used inconsistently (~17% core, ~7% adapters)** — risks runtime cycles. **Fix**: enable `@typescript-eslint/consistent-type-imports`; barrel-purity tests for every bounded context.
- **[LOW] SDK-13: Adapter manifest registered imperatively, no static discovery** — `AdapterMetadata` declared in `OnModuleInit` calls. **Fix**: require every adapter to `export const manifest: AdapterMetadata` from package root.

### OSS contributor DX (16 findings)

*(The original audit's DX-9 finding — "Test harness not exposed for plugin reuse" — has been merged into G1 since they are the same finding viewed from BE-architecture vs DX angles. Original DX numbering 1–8, 10–17 retained; renumbered to be contiguous below as DX-1 through DX-16.)*

- **[BLOCKER] DX-1: No LICENSE file** — `README.md:184` placeholder; no `LICENSE`/`COPYING`. **Fix**: Apache-2.0; update README; add `package.json#license`.
- **[BLOCKER] DX-2: No "Building a plugin / Adding a new integration" guide** — closest is `docs/connections-and-adapter-resolution.md:167-184` (15-line snippet). **Fix**: write `docs/plugin-author-guide.md`.
- **[BLOCKER] DX-3: No reference adapter signposted** — three integrations exist with no README in any. **Fix**: designate `libs/integrations/prestashop/` as the reference adapter; add a README; cross-link.
- **[HIGH] DX-4: CONTRIBUTING.md is incomplete and inconsistent with reality** — `CONTRIBUTING.md:16,33-34,38,74` (placeholder URL, wrong base branch, wrong migration command, incomplete dev stack). **Fix**: rewrite.
- **[HIGH] DX-5: Three different repository URLs across the OSS surface** — `README.md:28` (`SilkSoftwareHouse`), `CONTRIBUTING.md:16` (`your-org`), `.github/ISSUE_TEMPLATE/config.yml:4,7` (`piotrswierzy`). **Fix**: pick one canonical; replace everywhere.
- **[HIGH] DX-6: No "Add a new integration" issue template** — six existing templates, none integration-specific. **Fix**: add `.github/ISSUE_TEMPLATE/new_integration.md`.
- **[HIGH] DX-7: No PR template** — `.github/pull_request_template.md` does not exist. **Fix**: add with quality-gate + `Closes #N` checklist.
- **[HIGH] DX-8: No scaffolding/generator for new adapters** — `scripts/` has invariant-checkers only. **Fix**: ship `scripts/create-adapter.mjs` (Stage 1) or Nest schematic (Stage 2).
- **[HIGH] DX-9: No out-of-tree / npm plugin story** — every `libs/integrations/*/package.json` is `"private": true`; CD workflow disabled (`if: false`). **Fix**: document in-tree-only reality explicitly; add Changesets; declare port stability tiers in JSDoc.
- **[HIGH] DX-10: No CODEOWNERS, no governance** — `find . -iname CODEOWNERS` empty; no `GOVERNANCE.md`. **Fix**: add CODEOWNERS mapping per-integration owners; one-page governance doc.
- **[MEDIUM] DX-11: Top-level `ISSUE_*.md` files are repo cruft** — six files at root, last touched 2026-03-14. **Fix**: move to `docs/plans/legacy/` or delete.
- **[MEDIUM] DX-12: No `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`** — none exist. **Fix**: SECURITY most critical; add Contributor Covenant 2.1.
- **[MEDIUM] DX-13: CI uses `self-hosted` runners** — `.github/workflows/ci.yml:14, 41, 58, 86, 155`. Fork PRs from external contributors will not get CI signal. **Fix**: switch to `ubuntu-latest`, or also run on `ubuntu-latest` for `pull_request` events from forks.
- **[MEDIUM] DX-14: CI does not run on adapter-package changes deterministically** — `.github/workflows/ci.yml:74-78, 107-110` hardcodes `@openlinker/integrations-prestashop` and `-allegro`. **Fix**: replace with `pnpm -r --filter "./libs/**" build`.
- **[MEDIUM] DX-15: `docs/getting-started.md` is WIP and ends mid-flow** — §§ 8-9 are `_TBD_`. **Fix**: complete or trim.
- **[LOW] DX-16: README license placeholder + empty `.md` file at root** — `README.md:184`, `.md` 0-byte file. **Fix**: replace placeholder once LICENSE exists; delete `.md`.

---

## Out of Scope / Further Investigation

The following were explicitly *not* covered and are candidates for future audits:

- **Webhook routing extensibility** — how `WebhookToJobHandler` maps event types → sync jobs per platform. Inbound webhooks exist (`apps/api/src/webhooks/`) but the per-platform routing was not deeply audited.
- **AI provider plugin model** — whether new AI providers (beyond Anthropic, OpenAI, Fake) can be added out-of-tree.
- **Security model for third-party plugins** — untrusted plugin code running in the same Node process with full DB access.
- **Observability** — whether plugins can contribute structured logs, metrics, traces through a documented surface.
- **Per-port runtime contract testing** — is there a contract-test suite a plugin can run against its own implementation of `OrderSourcePort`? Spoiler: no, but the design wasn't drilled.
- **Bundle size and tree-shaking** — `type: "commonjs"` packages with `export *` barrels.
- **PrestaShop PHP module DX** (`apps/prestashop-module/`) — separate plugin ecosystem.
- **Performance of the dev stack** — whether `pnpm dev:stack:up` actually completes in reasonable time on a fresh laptop.
- **Accessibility audit** of the FE — `CreateOfferWizard` clearly takes a11y seriously, but no WCAG check was done.

---

## Appendix — Methodology

This review was synthesized from four parallel sub-audits, each delegated to a focused agent reading whole files (not excerpts):

1. **Backend plugin architecture** — adapter registry, integrations service, capability ports, ID mapping, core ↔ integrations boundary.
2. **Frontend plugin architecture** — feature slices, route registration, marketplace-specific UI, FE plugin hook points.
3. **Public API / plugin SDK readiness** — barrels, type leaks, DI tokens, versioning, framework coupling.
4. **OSS contributor DX** — README, CONTRIBUTING, license, governance, scaffolding, plugin docs, CI.

The final structure organises findings into 8 priority threads (mapping to GitHub milestones) and a 3-milestone sequenced roadmap.

### Verification log

The following BLOCKER and HIGH findings were independently spot-verified by the synthesizer against the live codebase before inclusion (file:line cites confirmed):

- **BLOCKERs verified**: A1 / DX-1 (no LICENSE — `ls -la` confirmed absence), B1 / DX-2 (no plugin guide — `ls docs/`), B2 / DX-3 (no reference adapter — `ls libs/integrations/`), C1 / BE-1 (`adapter-registry.service.ts:25-47`), C2 / BE-2 (`integrations.service.ts:301-315`), D1 / BE-3 (`adapter.types.ts:18-33`), D2 / SDK-2 (`identifier-mapping.types.ts:9-19`), F1 / SDK-1 (`libs/core/package.json:145-149`, `libs/shared/package.json:52-57`), H1 / FE-1 (full-tree grep for `slot|extension|plugin`), H2 / FE-2 (`api-client.ts:39-58`).
- **HIGHs verified**: B4 / DX-4 (`CONTRIBUTING.md:16,33-34,38,74`), A3 / DX-13 (`.github/workflows/ci.yml:14`), E1 / BE-5 (`sync-job.runner.ts:19-30`), E2 / BE-6 (`inventory-propagate-to-marketplaces.handler.ts:108-117`), D3 / FE-5 (`connections.types.ts:1-3`), F2 / SDK-4 (`logger.ts:10-16`).
- **Not personally verified** (sub-agent cite — high confidence but reader should re-check before acting): BE-7, BE-8, BE-9, FE-3, FE-4, FE-6, FE-7, FE-10, SDK-3, SDK-5, SDK-6, SDK-7, SDK-14 (F12), DX-5, DX-6, DX-7, DX-8, DX-9, DX-10, all MEDIUMs, all LOWs.

Confidence is high across the board, but findings without a personal-verification tick should be confirmed against the codebase before acting. Where a citation turns out to be stale (line drift, etc.) the *underlying* finding is almost certainly still valid — file the issue but update the cite.
