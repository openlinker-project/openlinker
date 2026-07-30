# Preflight divergence suite

Playwright project: `preflight-divergence` (registered in `apps/e2e/playwright.config.ts`).

Every spec in this directory pins ONE divergence between what the **bulk offer wizard promises before
submit** and what the **backend actually does after it**. The findings are numbered F1…F15; one spec file
per finding (`fNN-<slug>.spec.ts`).

---

## These are characterization tests. Read this before "fixing" a red run.

A characterization test documents behaviour **as it is**, not as it should be. Every spec here is written
so that it **PASSES while the divergence exists**.

> **A red run in this suite is not a product regression.** It means one of three things:
> 1. the finding was wrong in the first place,
> 2. the divergence has been **closed** (someone fixed it) — the spec should then be retired, or *inverted*
>    into an ordinary regression test that asserts the corrected behaviour, or
> 3. the stack under test is a different build from the one the finding was verified against.
>
> Re-read the spec's file header before touching anything: each one states the source evidence (file, symbol,
> commit) the claim rests on, and what a red run would mean for that particular finding.

Each spec asserts **both halves** of its divergence — (a) what the wizard shows/sends, and (b) what the
server/worker does with it — because a one-sided assertion cannot distinguish "the promise is wrong" from
"the execution is wrong".

---

## Coverage matrix

Status legend:

| Label | Meaning |
|---|---|
| **CONFIRMED live** | Runs on the current stack and passes: the divergence is reproducible here. |
| **NOT REPRODUCED** | Runs, but the asserted behaviour did not occur on this stack. |
| **SKIPPED — blocked on fixture** | `test.skip(...)`: the catalogue/connection state the divergence needs does not exist here. |
| **SKIPPED — fixed on this stack** | `test.skip(...)`: the deployed build no longer contains the backend half (the finding is closed *here*, not necessarily on `main`). |

Statuses below were derived by reading each spec's header, assertions and `test.skip` messages, cross-checked
against read-only fixture probes of the running stack on **2026-07-30**. Only **F15** was executed (twice,
green). No full-suite run was performed — see the filtering trap below for why that matters.

| # | What it pins | Spec | Status | Un-skip requirement |
|---|---|---|---|---|
| **F1** | The wizard's readiness only checks `section: 'product'` required params (`use-bulk-required-product-params.ts`); the builder rejects unresolved `section: 'offer'` params (`Stan`, id 11323). Green row → 202 → record `failed` / `PARAMETER_REQUIRED`. | `f01-offer-section-params.spec.ts` | CONFIRMED live | Needs an Allegro connection **and** a single-variant, not-yet-listed variant whose EAN resolves to a unique Allegro product **card** and whose matched category carries a required `section: 'offer'` param. Both present here (12 card-matched variants, 6 of them unlisted; category `261481` has required offer-param `Stan`). |
| **F2** | Already-listed variants: the wizard shows them `ready` (its duplicate guard even promises "creates a duplicate offer"), `filterAlreadyListed` silently drops them → smaller batch, or a 400 naming `productId`s the operator never saw. | `f02-already-listed-dropped.spec.ts` | Tests 1–2 CONFIRMED live; **test 3 SKIPPED — blocked on fixture** | Test 3 ("an offer that is no longer live still blocks its variant forever") needs a variant that is (1) already listed on Allegro, (2) barcode-matched to a product card, **and** (3) carries an `offer_status_snapshots` row whose `publicationStatus` is **not** `active` (ranked preference `ended` > `removed` > `unpublished` > `inactive` > `draft`). To create it: end or deactivate one of that connection's offers on the marketplace, then run the `marketplace.offer.statusSync` job so the snapshot refreshes. Every snapshot on this stack is `active`. |
| **F3** | Price `0`: no client-side floor on the flat-price config field or the row price editor, rows stay `ready`, then `@IsPositive()` 400s the WHOLE batch with an opaque `price: invalid value`. | `f03-zero-price.spec.ts` | CONFIRMED live | Test 1 needs a borrows-taxonomy `OfferCreator` destination (no `EanCategoryMatcher`) — the active Erli connection. Test 2 needs a taxonomy-owning destination (Allegro) plus a card-matched, priced, in-stock variant. Both present. |
| **F4** | A destination missing `config.masterCatalogConnectionId`: 100 % green wizard, 202 accepted, then every child record `failed` / `MASTER_CATALOG_NOT_CONFIGURED` — the preflight never reads that key. | `f04-master-catalog-missing.spec.ts` | CONFIRMED live | Needs a borrows-taxonomy `OfferCreator` connection that **currently has** `masterCatalogConnectionId` set (so the spec can clear and restore it), plus one priced, in-stock, barcoded, not-yet-listed variant. Erli has it (`→ 29bf253f…`). |
| **F5** | An Allegro connection with `sellerDefaults` never configured: nothing in the preflight looks at it, submit is accepted, then `AllegroOfferManagerAdapter.createOffer` fails every record with `SELLER_DEFAULTS_NOT_CONFIGURED`. Test 2 verifies the failure is at least *legible* in the batch table (the audit's downgrade). | `f05-seller-defaults.spec.ts` | CONFIRMED live | Needs an Allegro connection that **currently has** `sellerDefaults` (present) and one unlisted variant whose EAN resolves to an Allegro category. |
| **F6** | *(authored in parallel — file not present in this working tree at the time of writing)* | `f06-*.spec.ts` | not landed yet | Re-run this matrix once `f06-*` lands and fill in its row. |
| **F7** | Duplicate EAN, two independent halves: (a) the backend keys its seen-set on `ean.padStart(14,'0')` so `5901234500012` and `05901234500012` collide → 400, while the wizard keys the raw string and flags neither; (b) `duplicateEanVariantIds` is documented "batch-wide" but its only call site passes a single row, so a batch-wide duplicate is never surfaced. | `f07-duplicate-ean.spec.ts` | Test 1 CONFIRMED live; **test 2 SKIPPED — blocked on fixture** | Test 1 needs two unlisted variants of two *different* single-variant products (39 available). Test 2 needs two variants of two **different multi-variant** products carrying the **same** barcode — no such pair exists in this catalogue, and the PrestaShop master adapter cannot produce it (it only inherits a product-level EAN onto a variant when `combinations.length === 1`). Provision it from a master source that can write a duplicate barcode across products. |
| **F8** | The two invisible `1000` limits (`EXPANDED_OFFER_CEILING` → 422, `excludedVariantIds @ArrayMaxSize(1000)` → 400), neither surfaced anywhere in the wizard. Test 1 deliberately asserts the *non*-divergence: the 100-product cap **is** mirrored client-side. | `f08-ceilings.spec.ts` | Tests 1–3 CONFIRMED live; **test 4 SKIPPED — blocked on fixture** (hard `test.skip(true, …)`) | Test 4 (the 422 expansion ceiling) needs a selection expanding to **more than 1000 sibling variants after exclusions**, while `productIds` is itself capped at **100** — i.e. > 1000 variants concentrated in ≤ 100 products (e.g. 100 products × 11 combinations). This stack's whole catalogue is far below that. Requires bulk PrestaShop/WooCommerce provisioning the suite does not have: `OL_PS_WEBSERVICE_KEY` is unset by default and the webservice helper cannot create combinations. |
| **F9** | (1) `flat`/`cap` stock policies are offered for a multi-variant product and emitted per variant, then discarded — `buildEnqueueInput` uses `useMasterStock` for every sibling. (2) `publishEffective = stock > 0 ? publishImmediately : false` silently downgrades a zero-stock sibling to a draft, unlogged and unwarnable. | `f09-multivariant-stock-policy.spec.ts` | Tests 1–2 CONFIRMED live; **test 3 SKIPPED — blocked on fixture** (hard `test.skip(true, …)`) | Test 3 needs a **sibling of a multi-variant product whose master availability is 0** (or which has no inventory row at all — `masterAvailable ?? 0` collapses both). The operator-supplied stock cannot substitute: that is exactly the value half 1 proves is discarded. This stack has **zero** such siblings; its two zero-stock variants belong to *single*-variant products, where `useMasterStock` is false. Provisioning needs a PrestaShop **combination** set to 0 stock (`OL_PS_WEBSERVICE_KEY` unset by default; the webservice helper cannot address individual combinations). |
| **F10** | Capability-discovery mismatch: the backend arms its category gate by **duck-typing the resolved adapter instance** (`isCategoryBrowser`/`isEanCategoryMatcher`), which Erli satisfies whenever Allegro category *credentials* exist; the wizard reads the **static manifest**, which never lists `EanCategoryMatcher`, so it suppresses every category blocker. Green rows → 202 → every child `failed` on `overrides.categoryId / REQUIRED`. Test 2 sharpens it: unchecking "Allegro category access" does **not** disarm the backend. | `f10-erli-category-gate.spec.ts` | CONFIRMED live | Test 1 needs an active Erli connection that omits `EanCategoryMatcher` from `supportedCapabilities` **and** can actually read Allegro category parameters (probe returns 200 here), plus an unlisted, priced, imaged product. Test 2 additionally needs `config.allegroCategoryAccessEnabled === true` (it is). |
| **F11** | A master product name over 75 chars is never measured: the row is `ready` with no chip, the request carries **no** `title` override (so `@MaxLength(75)` cannot apply), and OL never measures the `product.name` the builder falls back to. The FE limit exists only inside the row editor. | `f11-title-overflow.spec.ts` | **SKIPPED — blocked on fixture** (by default) | Needs `OL_PS_WEBSERVICE_KEY` (+ a reachable PrestaShop base URL) so the spec can **provision** a fresh master product with a deliberately over-long name; there is no way to lengthen an existing name without mutating shared catalogue data. It also needs a master connection with `ProductMaster` actually *enabled*, and a barcode that resolves to an Allegro product card. Set `OL_PS_WEBSERVICE_KEY` in `apps/e2e/.env` to un-skip. **Separately masked:** the *final* consequence — "would the marketplace reject the over-long title?" — is unobservable, because F1's gate fires first: the record dies on `PARAMETER_REQUIRED` (offer-section `Stan`) before Allegro ever validates the title. The spec therefore asserts only what is observable (OL never reports a title problem, no offer is created) and records the real terminal reason in its `divergence` annotation. |
| **F12 / F12b** | The wizard injects `overrides.categoryId` into the per-product (multi-variant *family pin*) and per-variant (*edited row*) override maps, while `PerVariantOverrideDto.overrides = OmitType(CreateOfferOverridesDto, ['categoryId'])` forbids it under `whitelist + forbidNonWhitelisted` → whole-request 400. | `f12-category-override-rejected.spec.ts` | **SKIPPED — fixed on this stack** | The spec's own contract probe reports that this build **accepts** `categoryId` in both override maps, so the backend half is absent here and there is nothing to characterize *on this stack*. That is the fix from **PR #1930** (`a9477d60`, branch `1924-bulk-category-per-family-per-variant`), which is exactly what the running stack is built from: the DTO restores `categoryId` at the HTTP boundary and moves the variant-tier decision into `BulkListingSubmitService.stripVariantCategoryId`. The finding remains **REAL on `origin/main`** (verified by source read). To exercise it, deploy a build of `main` and re-run. Distinguish builds by grepping the deployed dist: `stripVariantCategoryId` present ⇒ the fix; `excludedVariantIds` absent ⇒ a pre-#1741 build. **Note:** #1930's description does not mention the *edit-modal* path, so re-check **F12b** explicitly against a post-fix build before retiring it. |
| **F13** | An included-but-**blocked** sibling reaches the server in *neither* channel: not in `excludedVariantIds`, not in `perVariantOverrides`. The only barrier is the review CTA's `disabled` attribute — there is no guard in `handleApproveAll`/`handleSubmit`, and `expandVariantJobs` expands the sibling anyway, minting a job + record for a variant the wizard itself declared unlistable. | `f13-blocked-not-excluded.spec.ts` | **SKIPPED — blocked on fixture** (on this stack) | Needs a multi-variant, not-yet-listed product with **at least one READY sibling alongside the blocked one** (otherwise the CTA reads `(0)` and `includedReady > 0` never holds). On this stack **no multi-variant product has a single card-linked sibling**, so every sibling carries the `needs-product-parameters` blocker until the editor is opened, and the ready-sibling precondition cannot be met. Un-skip by giving one sibling of a multi-variant product a barcode that resolves to an Allegro product **card** (card-linked rows are exempt from the required-product-parameter gate), or by mapping it into a category with no required product params. Test 2 replays the body captured by test 1 and is skipped with it. |
| **F14** | The FE trims the EAN (`effectiveVariantEan` → `raw.trim()`) so ` 5901234123457` reads as a valid GTIN-13 and the row is `ready`; `enforceIdentifierRules` reads `variant.ean` **literally**, sees a 14-char non-numeric string, fails the GS1 check digit and 400s the whole request. Only reachable through the state F13 creates (no per-variant override sent). | `f14-ean-trim.spec.ts` | Tests 1–2 CONFIRMED live; **test 3 SKIPPED — blocked on fixture** (hard `test.skip(true, …)`) | The divergence is real at the line level but its **precondition is unreachable**: no stored master `ean`/`gtin` can carry whitespace, because `MasterProductSyncService` normalises every ingested barcode through `normalizeToEan13`/`normalizeBarcode` (`trim()` + `replace(/\D/g,'')`, null for any non-12/13 length). Test 1 pins that normalisation invariant, so F14 becomes live — and this file goes red — the day it is relaxed (a new master adapter writing raw barcodes, a direct write path, a widened normaliser). Reproducing it end-to-end needs a `ProductVariant` row whose persisted `ean` starts with whitespace **plus** the F13 state; only a direct DB write (forbidden on this shared stack) or a normaliser-bypassing adapter can produce it. |
| **F15** | The multi-variant row editor emits a top-level `pricingPolicy` (and `stockPolicy`) inside the override map value; the DTO's per-map value class declares no such property, so `@ValidateRecordValues` (whitelist + `forbidNonWhitelisted`) 400s the whole request after a Review step that showed the row `ready`. | `f15-pricing-policy-rejected.spec.ts` | **CONFIRMED live** (executed 2026-07-30, both tests green) | Test 1 (contract probe) needs only an Allegro connection. Test 2 needs a **multi-variant**, not-yet-listed, priced master product whose row can be cleared through the editor — `pricingPolicy` is emitted only for `isMultiVariant`, so a single-variant product cannot exercise it. Three unlisted multi-variant products are available here. |

---

## Environment facts that bite

### The stack under test is **not** `main`

The running demo stack (`ol-demo-fresh-*`, web `http://localhost:8090`, API `http://localhost:3000`) is built
from the worktree **`/home/nor/projekty/blocky/ol-1924` @ `c7dd586f`** — a branch, not `origin/main`. That is
why F12 skips as *already fixed* (its fix, PR #1930, is on that branch) while the finding is still live on
`main`.

Consequences for anyone reading a run:

- A **skip** may mean "this build already fixed it", not "the finding is wrong". Every such skip message names
  how to tell the two apart.
- When a spec header cites source, it cites **both** trees (`ol-1924` and `origin/main`) whenever they differ,
  and says explicitly when they are identical.
- Read `ol-1924` **read-only**; it is a different worktree and must not be edited from here.

### `pnpm … --` does not filter

```bash
# ✗ runs the ENTIRE e2e suite — the `--` args are NOT forwarded as a filter
pnpm --filter @openlinker/e2e test:e2e -- --project=preflight-divergence tests/preflight-divergence/f03-zero-price.spec.ts

# ✓ run one spec
cd apps/e2e && npx playwright test --project=preflight-divergence tests/preflight-divergence/f03-zero-price.spec.ts

# ✓ run the whole project (slow; several specs hold 300–600 s budgets)
cd apps/e2e && npx playwright test --project=preflight-divergence
```

Several specs walk the whole catalogue, provision master products, and wait on worker round-trips. On a
resource-constrained machine, run one file at a time.

### Page-object drift — why these specs re-implement locators locally

`apps/e2e/src/pages/bulk-offer-wizard.page.ts` was written against an older build of the bulk wizard. It is
**shared with other suites and must not be edited from this suite**, so each spec re-implements the drifted
parts locally. Three drifts matter:

1. **`needsAttentionCount()` fails open.** It assumes the old "N row(s) need attention" hint and parses the
   **first** number it finds. The current Review step renders `N ready · M need attention · K excluded`
   (`bulk-review-step.tsx`), so the parse returns the **ready** count. A ready batch therefore reports a
   non-zero "needs attention", and `advanceToConfirmModal`'s needs-attention loop — which requires that number
   to *drop* after each edit — throws instead. Specs here read the labelled numbers off the `role="status"`
   summary (`(\d+)\s*need attention`, `(\d+)\s*ready`) rather than the first integer.
2. **The Review submit CTA was renamed.** The page object's `approveAllButton` matches `/^Approve all \(\d+\)$/`;
   the current build renders `Create offers (N)`. Specs use a tolerant
   `/^(Approve all|Create offers)\s*\(\d+\)$/` — the `(N)` suffix is what stops it from also matching the
   confirm modal's own bare `Create offers` button.
3. **The destination picker changed shape.** `selectConnectionIfPresent` drives a `<select>` labelled
   "Marketplace connection"; the Config step now renders a grouped **radio rail** (`PublishDestinationRail`)
   when more than one publish destination exists, and a plain "Publishing as {name}" alert when there is only
   one. Specs try the radio first and fall back to the page object's select path.

A fourth, smaller drift: `fillRowEditor` clicks **"Save row"**; the current edit modal's commit button is
**"Save all"** (`bulk-edit-modal.tsx`). Any spec that saves a row does so through its own locator.

### Specs that mutate shared state (and how they put it back)

| Spec | Mutation | Restore |
|---|---|---|
| `f04-master-catalog-missing.spec.ts` | Temporarily removes `masterCatalogConnectionId` from the destination connection's config (connection config is replaced wholesale, so the full object is rewritten). | Restored in a `finally`, re-read and asserted; a module-level `test.afterAll` re-asserts and repairs, failing loudly if the stack was left doctored. |
| `f05-seller-defaults.spec.ts` | Temporarily removes `sellerDefaults` from the shared Allegro connection's config. | Restored in `test.afterAll` and verified by re-reading the connection. The spec refuses to run at all if the connection has no `sellerDefaults` to restore. |
| `f10-erli-category-gate.spec.ts` (test 2) | Flips `config.allegroCategoryAccessEnabled` to `false` on the Erli connection. | Restored in a `finally` and asserted back to `true`. |
| `f11-title-overflow.spec.ts` | **Creates** a PrestaShop master product with a deliberately over-long name, then runs master product + inventory sync. | **Not** restored — the webservice client has no delete, so the product is left behind (same posture as the golden path's `E2E_FRESH_PRODUCT` mode). It is recorded in a `fixture` annotation. Submitted with "Publish immediately" unchecked. |
| `f02-already-listed-dropped.spec.ts` (test 1) | Creates ONE real offer — the surviving, not-already-listed variant. | Not undone; submitted as a **draft** ("Publish immediately" unchecked) so nothing goes live. |
| `f09-multivariant-stock-policy.spec.ts` (test 1) | Submits ONE real batch. | Not undone; created as **drafts** (`publishImmediately: false`). |
| `f13-blocked-not-excluded.spec.ts` (test 2) | Replays the captured wizard body against the live API, which is accepted (202) and mints a batch + child records. | Not undone; forced to `publishImmediately: false` before replay. Test 1 aborts its own POST at the network layer, so it creates nothing. |

Everything else in this directory is read-only: `f01`, `f03`, `f07`, `f08`, `f12`, `f14`, `f15` either end in a
400 (rejected in the validation pipe, before `bulkBatchRepository.create`) or never submit at all.

---

## Adding a finding

1. One file, `fNN-<slug>.spec.ts`, in this directory.
2. Header must state: the divergence in one sentence, the **source evidence** (file + symbol + commit/branch,
   for `ol-1924` *and* `origin/main` when they differ), which halves are asserted, what a red run means, and
   the fixture/side-effect policy.
3. Assert **both** halves — what the wizard shows/sends **and** what the server does.
4. Every `test.skip` message must be actionable: name the exact fixture or state needed to un-skip, and how to
   create it. A skip that only says "no fixture" is a bug in the spec.
5. Do not edit `apps/e2e/src/**` or `playwright.config.ts` from this suite — re-implement drifted locators
   locally and document the drift here.
6. Add a row to the matrix above.
