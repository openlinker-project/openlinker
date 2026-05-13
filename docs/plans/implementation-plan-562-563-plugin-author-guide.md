# Implementation Plan — Plugin author guide + reference adapter signpost (#562, #563)

Two BLOCKER findings from Modularity Thread B (#548 / #546):

- **#562** — No "Building a plugin / Adding a new integration" guide.
  External contributors who have read the README and architecture-overview
  still cannot answer *"where do my files go, which port do I implement,
  how does the registry pick up my adapter, how do I expose credentials,
  how do I write the tests."*
- **#563** — No reference adapter signposted. Three in-tree integrations
  (`allegro`, `prestashop`, `ai`) with no README in any of them. A
  first-time contributor has to read all three to figure out the canonical
  shape.

## Goals

- **#562** — Add `docs/plugin-author-guide.md`, a self-contained walk
  from "I want to add Platform X" to merging a working adapter. Covers
  port selection, package layout, factory wiring, registry registration,
  credentials/OAuth, connection-config shape validation, plugin-owned
  migrations, testing, and module wiring in the host.
- **#563** — Designate `libs/integrations/prestashop/` as the
  reference adapter by adding a short `README.md` to that package,
  pointing at the guide.
- Cross-link from `README.md`, `CONTRIBUTING.md`, and (informational)
  the existing `docs/connections-and-adapter-resolution.md` so anyone
  arriving at the repo finds the path.

## Non-goals

- **Scaffolding / `pnpm create-adapter`** (#564 — separate HIGH issue).
  #562's recommendation mentions it as step 2 of the proposed flow, but
  the scaffolding tool is its own piece of work. The guide will note
  that #564 is the future shortcut and document the manual-copy path
  today.
- **Add-integration issue template** (#567 — separate HIGH). The guide
  will cross-link to the existing `bug_report.md` / `developer_task.md`
  templates and note that an integration-specific template is on the
  way.
- **Pluralising guides for AI and Allegro plugins.** The guide names
  PrestaShop as the canonical reference per #563's recommendation
  ("designate prestashop explicitly"), with brief callouts pointing at
  `allegro` for the OAuth path and `ai` for the stateless-port-router
  shape. No separate per-platform README beyond the PrestaShop one.
- **Rewriting the rest of `docs/connections-and-adapter-resolution.md`.**
  Only the obsolete "Adding New Adapters" subsection (lines 167–184) is
  deleted by this PR — it's stale (claims you add to a static `Map` in
  `AdapterRegistryService`, but real registration is plugin
  self-registration in `onModuleInit`). The rest of that doc (adapter
  resolution semantics, connection entity, registry port shape) stays
  unchanged.
- **Plugin-SDK contract docs.** The contract is documented in
  `libs/plugin-sdk/src/adapter-plugin.ts` and `host-services.ts`
  header comments (verified during research). The author guide will
  *link to* those header comments, not duplicate them.
- **Semver / npm publishing guidance.** Every plugin package is
  `"private": true` today; npm publishing is gated on Modularity
  Thread F (#552). The guide will note the current state and point at
  #596 for the future.

## Layer classification

Pure **DX / Documentation**. No code, no tests, no architecture impact,
no migrations.

## Research findings (already validated)

Verified against the working tree at `f2cf874`:

- **No README** exists in any `libs/integrations/<x>/` package today.
- **Plugin-SDK structure** matches the `Explore` agent's report:
  `libs/plugin-sdk/src/{adapter-plugin.ts, host-services.ts,
  create-nest-adapter-module.ts, dispatch-capability.ts, index.ts}`.
- **`AdapterPlugin`** has 4 fields: required `manifest` + required
  `createCapabilityAdapter`, optional `register?(host)` + optional
  `migrations?`. Verbatim from `libs/plugin-sdk/src/adapter-plugin.ts`.
- **`HostServices`** splits into two blocks: *read inputs* (logger,
  identifierMapping, credentialsResolver, optional cache) and
  *side registries* (8 entries — adapterRegistry, factoryResolver,
  connectionTesterRegistry, emailNormalizerRegistry,
  retryClassifierRegistry, schedulerTaskRegistry,
  webhookProvisioningRegistry, connectionConfigShapeValidatorRegistry,
  connectionCredentialsShapeValidatorRegistry). Verbatim from
  `libs/plugin-sdk/src/host-services.ts`.
- **Plugin-specific cross-package deps** (e.g.,
  `CustomerProjectionRepositoryPort`, `IMappingConfigService`) are
  *not* in `HostServices` — passed via the plugin's
  `create<Platform>Plugin(deps)` factory constructor instead. This is
  the conservative cut documented inline in `host-services.ts:18–22`.
- **PrestaShop is the recommended reference**: 4 capabilities
  (ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager),
  no OAuth complexity, full set of side registrations (connection
  tester, webhook provisioner, config + credentials shape validators).
  See `libs/integrations/prestashop/src/prestashop-plugin.ts:55–68`.
- **Allegro is the OAuth reference**: token refresh, scheduler tasks
  (quantity polling), email normalizer (for masked emails), retry
  classifier, plugin-owned migration (`1767900000000-add-allegro-quantity-commands-table.ts`).
- **AI is the stateless-router reference**: no per-connection
  adapter; dynamic module via `AiIntegrationModule.register()`.
- **Host enablement**: `apps/api/src/plugins.ts` is the single edit
  point; `PluginRegistryModule.forRoot({ plugins: apiPlugins })`
  composes them.
- **Plugin-owned migrations (#599)** require TWO host-side edits:
  `apps/api/src/plugin-migrations.ts` + `scripts/plugin-migration-dirs.json`.
  Drift fails `pnpm lint` via `scripts/check-migration-timestamps.mjs`.

## Open decisions (please flag in review)

1. **Guide length / scope.** I'm aiming for ~600 lines — enough to
   cover the 11 sections concretely without padding. If you'd prefer
   a tighter "quick start" doc with separate "deep dive" sub-docs,
   single-line revert. Defaulting to one-file-comprehensive because
   that's what an external contributor wants on first read.

2. **PrestaShop as reference vs Allegro.** #563's recommendation says
   PrestaShop explicitly. My research agrees: it has the most ports,
   no OAuth complexity, and the broadest set of side registrations.
   Allegro gets a callout for OAuth; AI gets a callout for the
   stateless-router shape.

3. **Worked example: full adapter or excerpts?** Defaulting to
   structured excerpts (factory shape, plugin descriptor, integration
   module skeleton) with verbatim quotes from the PrestaShop adapter
   for the canonical bits. Writing a fictional "Shopify" worked
   example end-to-end would double the doc size and drift the moment
   the SDK contract evolves.

4. **Cross-link surface.** Add a one-line pointer in:
   - `README.md` § Contributing (above the existing
     CONTRIBUTING.md pointer)
   - `CONTRIBUTING.md` § Pull Request Process (after the existing
     branch-naming step)
   - `docs/connections-and-adapter-resolution.md` § Adding New Adapters
     (note: the new guide supersedes this section; cleanup deferred)

## Implementation steps

### Step 1 — `docs/plugin-author-guide.md` (#562)

**File:** `docs/plugin-author-guide.md` (new, ~600 lines)

Top-to-bottom outline:

1. **Title + framing** — "This guide is for an external contributor
   who wants to add a new platform integration (e.g., Shopify,
   WooCommerce, BigCommerce) to OpenLinker." One-paragraph TL;DR with
   "the 7-step path" inline. Explicit expectation-setting paragraph:
   *"This guide is a map for reading `libs/integrations/prestashop/`,
   not a copy-paste tutorial. The canonical reference is the code;
   this guide is the map to read it by."*

2. **Prerequisites** — pnpm 10+, Node 18+, Docker (for the dev
   stack), familiarity with `docs/architecture-overview.md` § *Core
   Bounded Contexts* and § *Capability Abstractions*. Link to
   `CONTRIBUTING.md` setup checklist.

3. **Pick a capability port** — quote `CoreCapabilityValues`
   **verbatim** from `libs/core/src/integrations/domain/types/adapter.types.ts:22-28`
   (don't restate in prose; drift risk). One-line description of each
   capability port and where its interface lives in CORE. Note the
   open-set rule (#576): plugins can declare new capability names if
   the target platform doesn't fit one of the existing ones.
   Recommend starting with one capability and adding more
   incrementally.

4. **Use PrestaShop as your starting point** — short paragraph
   designating it. List the 4 capabilities it implements, note that
   it's the most port-rich adapter and the recommended template.
   Cross-link to `libs/integrations/prestashop/README.md` (added in
   Step 2 below).

5. **Package layout** — annotated tree of
   `libs/integrations/prestashop/src/` showing where each layer
   lives:
   - `application/` — adapter factory, DTOs, interfaces
   - `domain/` — types, exceptions
   - `infrastructure/adapters/` — port implementations + HTTP client
   - `infrastructure/provisioners/` — cross-cutting side effects
   - `infrastructure/http/` — HTTP client + auth glue
   - `infrastructure/mappers/` — wire-format ↔ domain mappers
   - `migrations/` — plugin-owned migrations (if any; PrestaShop has
     none, Allegro has one — cross-reference)
   - `__tests__/` — mocks + fixtures + unit specs (colocated
     `__tests__/` dirs are the convention)
   Verbatim `package.json` shape (from PrestaShop), `tsconfig.json`
   note, barrel `src/index.ts` shape.

6. **The `AdapterPlugin` contract** — quote the interface fields with
   one-paragraph explanations of each. Link to the *exact line ranges*
   of the header comments rather than the bare file path:
   - `libs/plugin-sdk/src/adapter-plugin.ts:42-110` — `AdapterPlugin`
     interface
   - `libs/plugin-sdk/src/host-services.ts:50-121` — `HostServices`
     bag (read-inputs vs side-registries split)
   GitHub's `.ts` blob view skips JSDoc rendering; the line range
   lands the reader inside the relevant block instead of at the top
   of the file. Explain the two authoring patterns:
   - **`createNestAdapterModule(plugin)` helper** — for plugins
     with no plugin-specific Nest providers. Single-line module file.
   - **Inline-from-module pattern (Allegro/PrestaShop)** — for
     plugins with their own `@Injectable` providers (repositories,
     provisioners, HTTP clients). Show the `onModuleInit` recipe
     from PrestaShop. Note this is the more common pattern in
     practice.

7. **Implementing a capability port** — using
   `PrestashopOrderProcessorManagerAdapter` as the worked example.
   Cover:
   - Where the port interface lives in CORE (`@openlinker/core/<ctx>`
     barrel import — *never* deep paths, link to engineering-standards
     § *Import Aliases*).
   - Class signature: `implements OrderProcessorManagerPort`.
   - Constructor: inject HTTP client + `IdentifierMappingPort` + plugin-
     internal helpers.
   - Method shape: validate inputs, call the platform API, map
     response, translate errors to domain exceptions.
   - Throwing for unsupported operations — example pattern.

8. **Adapter factory + registry** — `PrestashopAdapterFactory.createAdapters`
   walkthrough. Cover:
   - When the factory is constructed (once at boot) vs invoked
     (per `createCapabilityAdapter` call).
   - How config is validated (`validateAndParseConfig(connection.config)`).
   - How credentials are resolved
     (`credentialsResolver.get<T>(connection.credentialsRef)`).
   - How adapters are assembled into the per-capability map and
     returned.
   - `adapterKey` naming (`<platform>.<api-version>.<version>` —
     e.g., `prestashop.webservice.v1`, `allegro.publicapi.v1`).
   - `manifest` static export (named `<platform>AdapterManifest`)
     and why it exists as both a top-level `const` and as `plugin.manifest`
     (same reference — no drift; #575).

9. **Connection-config and credentials shape validation** —
   `class-validator` DTO pattern in
   `application/dto/<platform>-connection-config.dto.ts` plus the
   adapter wrapping it. Show the validator-registry registration in
   `register(host)`. Note that shape validation is separate from
   *"do these credentials actually authenticate"* — the latter is
   `ConnectionTesterPort` against the live API.

10. **Credentials / OAuth** — bump to ~40 lines covering both shapes
    concretely; a one-paragraph callout is too thin for someone
    implementing their first OAuth flow.
    - **Non-OAuth (PrestaShop):** simple `{ apiKey: string }` payload,
      validated at create-time via the credentials shape validator,
      encrypted in `integration_credentials`. Path to the validator
      file. Where the API key is read on each request.
    - **OAuth (Allegro):** cover the *shape* before pointing at the
      code:
      - **Token tables** — plugin-private migration creates the
        token row; pre-#599 shape with example schema.
      - **Token-refresh service** — `AllegroTokenRefreshService`
        signature, when it's called (constructor or per-request
        callback).
      - **Shared state** — `AllegroConnectionTokenState` is the
        in-memory token + expiry, shared between the OAuth and
        webservice HTTP clients so a refresh updates both. Pattern
        an external plugin author needs to replicate.
      - **401 → refresh → retry** — handler signature in the HTTP
        client.
      - **Where the live code lives** —
        `libs/integrations/allegro/src/infrastructure/http/` for the
        full walkthrough. The guide gives shape; code is spec.

11. **Plugin-owned migrations** — when you need them, the recipe
    from `docs/migrations.md § Plugin-Owned Migrations (#599)`. Three
    edits: (a) write the migration in
    `libs/integrations/<platform>/src/migrations/`, (b) add the dir
    to `apps/api/src/plugin-migrations.ts`, (c) add the same dir to
    `scripts/plugin-migration-dirs.json`. Cross-link to migrations
    doc for the timestamp-uniqueness rule. Allegro's existing
    migration is the worked example.

12. **Tests** — unit and integration patterns:
    - **Unit specs** (`__tests__/<name>.spec.ts`): mock the HTTP
      client + `IdentifierMappingPort` via the existing factory
      helpers; test request shape, parsing, error mapping, port
      contract. Cross-link the existing `testing-guide.md`.
    - **Integration specs** (`apps/api/test/integration/**/*.int-spec.ts`):
      Testcontainers-based; opt-in PrestaShop container helper for
      adapter-shape verification. Cross-link to
      `docs/testing-guide.md § PrestaShop Testcontainer Pattern (#506)`.
    - **Vertical slice** (`apps/api/test/integration/orders/allegro-prestashop-carrier-mapping.int-spec.ts`)
      as the reference for end-to-end adapter integration tests.

13. **Wiring the plugin into the host** — `apps/api/src/plugins.ts`
    is the single edit point. Show the existing
    `apiPlugins` array; explain that adding your `MyIntegrationModule`
    to that array is the host-enablement step.

14. **Gotchas / things to know** —
    - Import-aliases rule (#591): top-level barrel for cross-package,
      never deep paths into `@openlinker/core/<ctx>/...`.
    - `orm-entities` sub-barrels are off-limits to plugin packages
      (#594, ESLint-enforced).
    - Plugin packages are `"private": true` today (npm publishing
      depends on Modularity Thread F, #552/#596).
    - Capability is open at the registry boundary (#576).
    - Plugin migrations require the TWO-edit host wire-up (drift
      surfaces as `relation "..." does not exist` at runtime).

15. **Where to ask questions** — open a discussion or an issue using
    the existing `bug_report.md` / `developer_task.md` templates;
    note that an integration-specific template is planned (#567).

16. **Related reading** — links to:
    - `docs/architecture-overview.md`
    - `docs/engineering-standards.md`
    - `docs/connections-and-adapter-resolution.md`
    - `docs/migrations.md`
    - `docs/testing-guide.md`
    - `libs/plugin-sdk/src/adapter-plugin.ts` (header comment is the
      contract spec)
    - `libs/plugin-sdk/src/host-services.ts` (HostServices spec)

### Step 2 — `libs/integrations/prestashop/README.md` (#563)

**File:** `libs/integrations/prestashop/README.md` (new, ~30 lines)

Short and focused. Sections:

- One-paragraph "This is the OpenLinker reference adapter" header.
  States that it implements ProductMaster, InventoryMaster,
  OrderSource, OrderProcessorManager via the PrestaShop WebService v1
  API.
- "New adapter authors should copy this package's layout as your
  starting point. See [`docs/plugin-author-guide.md`](../../../docs/plugin-author-guide.md)
  for the full walkthrough."
- Brief callouts of what's *not* in this adapter — *"OAuth and
  token refresh: see `libs/integrations/allegro/` for that pattern.
  Stateless port-router: see `libs/integrations/ai/`."*
- One-line capability-port list with file links into the package.
- Pointer to operator docs at `docs/integrations/prestashop/{setup,runbook,manual-testing}.md`
  (those exist; this README is for *building* an adapter, the operator
  docs are for *running* one).

### Step 3 — Cross-links + obsolete-section delete

- **`README.md`** — add one bullet under `## Contributing` (currently
  one-line pointer to CONTRIBUTING.md): *"Building a plugin? See the
  [Plugin Author Guide](./docs/plugin-author-guide.md)."*
- **`CONTRIBUTING.md`** — add a new top-level section
  `## Building a New Integration` between `## Architecture` and
  `## Pull Request Process` (workflow surface, not a PR step). One
  short paragraph linking to the guide. Discoverable in the TOC and
  in the rendered doc's section list.
- **`docs/connections-and-adapter-resolution.md`** — **delete** the
  obsolete `### Adding New Adapters` subsection (lines 167–184). The
  stale code snippet there (claims you edit a static `Map` in
  `AdapterRegistryService`) is exactly what #562 was filed against;
  carrying it forward as cruft re-creates the drift the new guide is
  meant to solve. Replace with a one-line pointer:
  `See [Plugin Author Guide](./plugin-author-guide.md) for the full
  walkthrough of adding a new integration adapter.`
- **`apps/api/src/plugins.ts`** — add a one-line header comment at
  the top of the file: `// Adding a new integration? See
  docs/plugin-author-guide.md.` This is where contributors land when
  they're ready to enable their plugin; the comment costs nothing and
  meets them at the right moment.

### Step 4 — Quality gate

Per CLAUDE.md, run in order:

1. `pnpm lint` — confirms no broken markdown links or invariant drift.
2. `pnpm type-check` — sanity (no code changes, should no-op).
3. `pnpm test` — sanity.

None of the gate steps directly exercise the new files. The real
verification is:

- Manual re-read of `plugin-author-guide.md` against the actual files
  it references — every code path it quotes (factory shape, plugin
  descriptor, registration calls) must match what's in
  `libs/integrations/prestashop/src/`.
- Grep for any path in the guide that doesn't resolve.

### Step 5 — Self-review

Walk the diff against #562 / #563 acceptance criteria:

- **#562 acceptance** — guide covers all 7 points in the issue's
  recommendation: (1) port pick, (2) scaffolding note (deferred to
  #564), (3) port + factory, (4) registry registration, (5)
  credentials/OAuth, (6) testing pattern, (7) doc expectations. ✓
- **#563 acceptance** — PrestaShop README exists, designates the
  package as reference, points at the plugin author guide. ✓
- Cross-links present in README, CONTRIBUTING, and the existing
  connections-and-adapter-resolution doc.
- Every file path quoted in the guide resolves against the working
  tree.

## Risks

- **Doc drift over time.** A 600-line doc that references concrete
  paths, class names, and registry-method signatures will go stale
  the next time someone refactors the plugin SDK. Mitigations:
  - Keep code excerpts short and link to the live file for the long
    form.
  - The `AdapterPlugin` and `HostServices` contracts already have
    rich header comments — link to those rather than duplicating
    (with explicit line ranges per Section 6 above).
  - Footer with *"Last verified at commit `<sha>`. If you spot
    drift, please open an issue or PR."* — honest framing that it's
    a hint, not a guarantee. Lower-effort than a lint invariant and
    sets reader expectations correctly.
  - **Future hardening (out of scope today):** `pnpm lint` invariant
    grep-checking key claims against live code, or doc-test-style
    code snippets that import the actual types. Tracked for a
    follow-up if drift becomes a real problem.
- **Path conflicts with parallel work (PR #678 / #665).** PR #678
  is editing `libs/core/src/listings/application/services/`. My doc
  references the listings package as one of the capability port
  homes (`OfferManagerPort`). No file conflict — my changes are all
  under `docs/` and `libs/integrations/prestashop/README.md` — but
  the guide's pointer text to `OfferManagerPort` should be a
  *capability-name* reference, not a *file-path* reference, to be
  immune to the cleanup in #678.
- **Adapter-as-source-of-truth risk.** The guide tells contributors to
  copy PrestaShop. If PrestaShop drifts from the documented patterns
  (e.g., starts using a deprecated registry method), the guide becomes
  misleading. Mitigation: the guide cites *patterns* with PrestaShop
  paths as examples, not as the spec — the spec is in
  `engineering-standards.md` and the SDK header comments.

## PR body checklist

- [ ] `docs/plugin-author-guide.md` exists, ~600 lines, covers the 7
      points in #562's recommendation.
- [ ] `libs/integrations/prestashop/README.md` exists, designates
      PrestaShop as reference, points at the guide.
- [ ] Cross-link in `README.md` § Contributing.
- [ ] Cross-link in `CONTRIBUTING.md` § Pull Request Process.
- [ ] Cross-link prepended to `docs/connections-and-adapter-resolution.md`
      § Adding New Adapters.
- [ ] All file paths referenced in the guide resolve against the
      current working tree.
- [ ] `pnpm lint` + `pnpm type-check` + `pnpm test` pass.
- [ ] Closes #562, #563.

## Out-of-PR follow-ups

- **#564** — `pnpm create-adapter <name>` scaffolding tool. The guide
  notes this is the future shortcut; until then, contributors do
  manual copy-from-PrestaShop.
- **#567** — Add-integration GitHub issue template. The guide notes
  this is planned; for now, contributors use the existing templates.
- **#569** — Resume / finish `docs/getting-started.md` (currently
  ends mid-flow). Independent of the plugin guide; mentioned only as
  related work.
- **Cleanup of `docs/connections-and-adapter-resolution.md` § Adding
  New Adapters**. The new guide supersedes that 15-line section; once
  the guide is reviewed, the old section can be deleted in a follow-up
  PR (not this one).
