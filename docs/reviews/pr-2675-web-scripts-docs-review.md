# PR #2675 review — `apps/web`, `scripts`, `docs`, `.eslintrc.js`

Base `origin/oms-programme-wave-2` @ `06994c4aa`. Node 22.22.1.

The programme's signature defect is **a check that cannot fail**, and it lives in this
area. The method below is therefore falsification, not reading: every gate was made to
report red before it was trusted to report green.

## Gate inventory (derived, not quoted)

- `pnpm check:invariants` = **77 chain steps** over **43 distinct scripts**
  (42 `.mjs` + `check-fixture-purity.sh`). **34** steps carry `--self-check`.
- No `check-*` script exists on disk that is unwired from the chain.

## Sweep A — file-absence ("not found" must not read as "agrees")

Every input path of every gate was removed in turn and the gate re-run. Findings acted on:

| Gate | Missing input | Was |
|---|---|---|
| `check-stream-writes` | any of its 3 roots | green, `0 source file(s) checked` |
| `check-types-sub-barrels` | `libs/core/src/orders/types.ts` | green, set silently shrank |
| `check-description-format-mirror` | the FE mirror's vocabulary | green (never compared — #2790) |

Eight mirrors also stay green when their **ADR/doc** side is absent. That side is
advisory in each (the core↔FE comparison still runs), so it is recorded, not changed.

## Sweep B — value drift: script → what was broken → did it go red

All 43. `RED` = the gate failed as it claims to.

| Gate | Mutation applied | Result |
|---|---|---|
| allegro-seller-defaults-mirror | dropped `sellerDefaults.location.province` from the FE list | RED |
| architecture-gates | added a 4th ladder rung capability | RED |
| attention-reason-mirror | renamed `title` in `return-detail.copy.ts` | RED |
| authority-kind-mirror | renamed `'returns-disposition'` in core | RED |
| automation-merge-field-mirror | added a bogus FE merge field | RED |
| connection-backlog-status-mirror | renamed `'unknown'` on the FE side | RED |
| contract-suite-not-in-production | production import of `fulfillment/testing`; barrel re-export | RED (both) |
| core-capability-mirror | renamed `'FulfillmentExecutor'` on the FE side | RED |
| create-adapter | added a template file | RED |
| **cross-context-imports** | re-added a `products` repo port to `offer-builder.service` | **GREEN → fixed (#2791)** |
| css-structure | deleted one closing brace in `index.css` | RED |
| **description-format-mirror** | renamed / dropped an FE source value | **GREEN → fixed (#2790)** |
| design-tokens | renamed a token in `index.css` only | RED |
| fiscal-reconcile-outcome-mirror | renamed `'still-unknown'` on the FE side | RED |
| fiscal-registration-progress-mirror | renamed `'not-requested'` on the FE side | RED |
| fixture-purity | added a `@nestjs/common` import to the shared fixture | RED |
| hold-reason-mirror | swapped two FE members (order-strict) | RED |
| jest-integration-mappers | added an unmapped plugin to `apps/api/src/plugins.ts` | RED |
| ksef-forma-platnosci-drift | dropped code `7` on the FE side | RED |
| libs-build-scripts | renamed a package `build` script | RED |
| migration-timestamps | added a far-future migration | RED |
| no-injection-contracts | imported `@openlinker/core/orders` into `fulfillment` | RED |
| no-supported-actions-mirror | planted `deriveSupportedActions` in `apps/web` | RED |
| nul-bytes | wrote a literal NUL into a `.ts` | RED |
| order-lifecycle-phase-mirror | renamed `'held'` on the FE side | RED |
| outbound-http | bare `fetch()` in a plugin | RED |
| parameter-restriction-mirror | dropped `TOO_MANY_VALUES` on the FE side | RED |
| permission-mirror | renamed `'connections:read'` on each side | RED (both) |
| plugin-guide-quotes | shifted the pinned line range; drifted a quoted value | RED (both) |
| render-template-fixture-drift | renamed a shared fixture key | RED |
| repo-urls | reintroduced a `SilkSoftwareHouse` URL | RED |
| resolve-stream-mirror | renamed an FE event `kind` | RED |
| retry-refusal-reason-mirror | dropped `'retry-exhausted'` on the FE side | RED |
| return-stage-mirror | swapped two FE stages (order IS the ordinal) | RED |
| sales-document-reason-mirror | renamed `'trigger-model-manual'` on the FE side | RED |
| service-interfaces | (verified via existing `--self-check`) | RED |
| shipping-tax-split-mirror | drifted the FE mirror | RED |
| stock-and-pricing-preview-mirror | renamed `'none'` in the FE preview | RED |
| **stream-writes** | bare `.xAdd` — **from a non-root CWD** | **GREEN → fixed (#2792)** |
| system-connection-id-mirror | changed one digit of the placeholder id | RED |
| **types-sub-barrels** | unapproved value re-export — **from a non-root CWD** | **GREEN → fixed (#2792)** |
| **ui-vocabulary** | banned term in `delivery-copy.ts` | **GREEN → fixed** |
| workspace-dep-declarations | removed a declared workspace dep still imported | RED |

## Fixes made

1. **`check-ui-vocabulary` skipped every `-copy.ts`** (new finding, the signature class
   recurring). `isScannable` matched only `.copy.ts`, so `delivery-copy.ts`,
   `stock-at-risk-copy.ts` and `restock-target-copy.ts` — two of them carrying real
   operator sentences, all three under **live** scan roots — were never read. Planting
   `authority` + `holder` in `delivery-copy.ts` left the gate green; the same string in a
   sibling `*.copy.ts` went red. The separator is now a parameter, and a new `Z4` guard
   fails any `.ts` whose name says copy but which the matcher would skip. 135 → 138 files
   scanned, no pre-existing violations uncovered.
2. **#2790** — the description-format source mirror had **never compared anything**. The
   frontend encodes the vocabulary as an inline union on `resolvedVia`, never as the const
   array the gate looked for, so `parseConstArray` returned `null` and the guarding `&&`
   short-circuited on every run. Now reads the union the frontend actually declares, and an
   unparseable side is a **failure**. Falsified four ways.
3. **#2791** — eight stale `ALLOW_LIST` rows, all rewired under #718. Proven against the
   unmodified script: re-adding `ProductVariantRepositoryPort` to `offer-builder.service.ts`
   **passed**. Rows dropped, and a stale-row check added so the class cannot recur.
   Core-to-core allow-listing is now **empty** (#718 discharged).
4. **#2792** — `check-stream-writes` (`process.cwd()`) and `check-types-sub-barrels`
   (relative `CORE_SRC`) reported success for scanning nothing from any non-root CWD. Both
   roots anchored to the script file, and both given a floor on what they must discover, so
   a future glob typo also fails.
5. **#939 in `order-snapshot.schema.ts`** — `totals.taxTreatment` used `.optional()`, which
   rejects `null`; core documents `null` as "the source did not assert". Totals parse as one
   section, so one `null` dropped subtotal, tax, shipping, total *and* currency. Pre-existing,
   fixed with a regression test that reports `expected undefined to be 12.3` without the fix.

## Frontend checks

- **Copy coverage** — all `*.copy.ts` under the 5 scan roots are reachable; the three
  `-copy.ts` holes are closed (above).
- **Zod boundary schemas** — every Wave-2/3a `api/*.schema.ts` is `.nullish()`-only
  (the `.optional()` matches are docblock prose). The one real violation is fixed.
- **Layering / ESLint** — both `no-restricted-imports` groups carry the identical 20
  cross-imported feature slugs; the four new slugs (`automation`, `fulfillment`,
  `fulfillment-authority`, `returns`) are in **both**. (`app` in the plugins group is a
  non-feature namespace, correct.)
- **Write gating** — every new write control renders disabled rather than hidden per the
  `useWriteAccess` contract, and each FE permission matches its route's `@Roles`:
  `PUT /fulfillment-authority/presets` (`admin`) ↔ `connections:write` (admin-only);
  automation retry/dismiss/CRUD (`admin`) ↔ `automations:write` (admin-only — `operator`
  holds only `automations:read`). No enabled-control-that-403s found.
- **`index.css`** — 3316 blocks balanced; deleting one closing brace is caught.

## Counts verified against code

- Lane caps sum to **26** (`4 + 12 + 2 + 8`) — matches ADR-050.
- **23** scheduler task descriptors — matches ADR-051.
- **64** `JobTypeValues` members; **7** Allegro scheduler tasks, **all 7 default-ON**
  (`enabledDefault` defaults `true` and none opts out).
- Cross-context allow-list: **112** entries / **99** files — `architecture-overview.md`
  said 20/64; corrected.

## Not fixed — reported

- **`EanMatchResultKindValues` is an unguarded mirror.** Both `libs/core` and `apps/web`
  declare it under the same name; `check-resolve-stream-mirror` explicitly scopes it out
  (honestly, in its docblock). Dropping a member on the FE side is not caught.
- **`check-no-supported-actions-mirror` prints `no FE mirror found` and exits 0** — the
  #2790 shape in its reporting, though its `--self-check` does make the matchers real.
- **`check-outbound-http` reports "scanned 11 roots", never a file count** — its root is
  correctly anchored, so this is honesty of reporting rather than a hole.
