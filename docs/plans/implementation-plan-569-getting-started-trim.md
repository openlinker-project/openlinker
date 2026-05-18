# Implementation Plan — #569 `docs/getting-started.md` is WIP and ends mid-flow

| Layer | Scope | Risk |
|---|---|---|
| DX / docs | Single-file edit | Low — pure docs |

## 1. Decision: trim, don't fabricate

The issue lists both options ("complete §§ 8-9" or "trim to what works today") but
explicitly favours trimming: *"The first 7 sections are excellent and shouldn't
be hidden behind a 'this doc is incomplete' warning."*

Reasons to trim, not fill:

- The `_TBD_` sections cover live behaviours (offer creation on Allegro, full
  Allegro→PrestaShop order sync) that require a running dev stack to verify.
  Writing them blind risks #660-style breakage where docs promise commands /
  flows that don't actually work.
- The doc through §7 is verified and useful as-is; the WIP banner makes
  contributors hesitate to follow it.
- The end-to-end-order walkthrough is already tracked in #152 (the E2E
  clean-state test epic) and the offer-creation flow in #429 (Allegro
  offer-creation epic). Pointing at those forward-looking issues is more honest
  than two `_TBD_` headings.

## 2. Cross-doc scan

Grep results for `getting-started`:

- `docs/plans/*.md` — historical plan docs only, no link rot.
- `docs/operations/prestashop-module-rename-migration.md:18` — generic pointer
  to "install fresh per `docs/getting-started.md`"; no anchor reference.
- `docs/reviews/modularity-and-plugin-readiness-2026-05-09.md` — the source
  audit; references this issue's line numbers, not user-facing.

README and CONTRIBUTING contain **no references** to `getting-started.md` today,
so no anchor rot to worry about.

## 3. Three edits

### 3.1 Lead paragraph (line 3)

Adjust scope to match what's documented:

```diff
- End-to-end walkthrough: from a clean machine to a first Allegro order synced into PrestaShop via OpenLinker.
+ End-to-end walkthrough: from a clean machine to a fully-configured OpenLinker instance with PrestaShop and Allegro connected, catalog synced, and categories mapped — ready to start creating offers and ingesting orders.
```

Honest framing: the doc gets you to "ready to use", not "first order synced".

### 3.2 Drop WIP banner (lines 5-6)

Remove entirely:

```diff
-
- > **Status:** work in progress. Built incrementally as part of [#152](https://github.com/openlinker-project/openlinker/issues/152). Sections marked _TBD_ are not yet documented.
-
```

The banner exists to warn readers about `_TBD_` sections; once those sections
are removed, the banner has nothing to flag.

### 3.3 Replace §§ 8-9 (lines 237-243) with `## What's next`

```diff
- ## 8. First offer
-
- _TBD_
-
- ## 9. First order end-to-end
-
- _TBD_
+ ## What's next
+
+ With both connections active, products discovered, and at least one category
+ mapped, you're ready to:
+
+ - **Create your first Allegro offer from a PrestaShop product.** Walkthrough
+   in progress — tracked in [#429](https://github.com/openlinker-project/openlinker/issues/429)
+   (Allegro offer-creation epic). The flow is functional today; the screenshot-
+   level guide is the next doc to land.
+ - **Watch an Allegro order land in PrestaShop.** End-to-end sandbox walkthrough
+   tracked in [#152](https://github.com/openlinker-project/openlinker/issues/152)
+   (clean-state E2E epic). The ingestion path is exercised by the carrier-
+   mapping vertical-slice int-spec
+   ([#535](https://github.com/openlinker-project/openlinker/pull/671)) — the
+   user-facing walkthrough is the missing piece.
+
+ Until those walkthroughs land, the **Jobs & Logs** page in the OpenLinker web
+ app (`http://localhost:4173/jobs`) is the best place to watch sync activity,
+ and the **Orders** page surfaces orders as they ingest.
```

Result: the doc now ends with a forward-looking pointer, not an empty
`_TBD_` cliff.

## 4. Quality gate

Pure docs — no `pnpm test` impact. Run:

```bash
npx prettier --check docs/getting-started.md docs/plans/implementation-plan-569-getting-started-trim.md
pnpm lint
```

`pnpm type-check` and `pnpm test` are no-ops on these files but should still
pass — the pre-commit hook runs the full triad anyway.

## 5. Commit

Single conventional-commit:

```
docs(getting-started): trim to what works today + drop WIP banner (#569)
```

## 6. Acceptance — #569

- [x] WIP banner removed.
- [x] `_TBD_` sections removed.
- [x] Doc reads cleanly end-to-end through §7.
- [x] Forward pointers to #152 and #429 land the deferred work in tracked
      epics, not in a "doc incomplete" warning.
- [x] Lead paragraph honestly describes what the doc covers.
