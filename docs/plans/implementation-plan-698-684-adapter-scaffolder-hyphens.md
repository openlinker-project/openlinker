# Implementation Plan — #698 + #684 final: adapter scaffolder hyphen-safe + drift guard locks it in

**Branch:** `698-684-adapter-scaffolder-hyphens`
**Base:** `main` (5fe7c0d)
**Scope:** Modularity Thread B (#548) — plugin author scaffolding.

---

## 1 — Understand

### Goal

Make `scripts/create-adapter.mjs` produce compilable TypeScript for hyphenated slugs (`smoke-test`, `woo-commerce`, …), and extend `scripts/check-create-adapter.mjs` to scaffold a hyphenated slug at lint-time so this drift class cannot return.

### Layer

DX / tooling — no runtime code, no API surface, no migration. All edits in `scripts/` and `.github/workflows/` (the latter optional).

### Non-goals

- **No tsc-noEmit in lint** — explicitly deferred from #684's original ask; the CI workflow `.github/workflows/scaffold-smoke.yml` (shipped via #695) is the right place for that and already exists.
- **No regex tightening to ban hyphens** — issue body's option 2. The help text advertises hyphens; preserving them is the better contract.
- **No changes to the shipped plugins** (`prestashop`, `allegro`, `ai`) — their slugs are non-hyphenated, so they sidestep the bug.

---

## 2 — Research

### Bug surface

`scripts/create-adapter.mjs` ships three substitution tokens:

| Token | Form | Example for `smoke-test` |
|---|---|---|
| `__name__` | raw lowercase slug | `smoke-test` |
| `__Name__` | PascalCase | `SmokeTest` |
| `__BRAND__` | defaults to `__Name__` | `SmokeTest` |

The `__name__` token is correct for **filenames** (the directory IS hyphenated), **string literals** (`adapterKey: '__name__.publicapi.v1'`), and **module paths in comments**. It is **wrong for TypeScript identifier positions** — `smoke-testAdapterManifest` parses as subtraction.

### Affected template positions (verified via `grep`)

Six identifier positions across two template files:

- `scripts/create-adapter-templates/src/__name__-plugin.ts:50` — `export const __name__AdapterManifest`
- `scripts/create-adapter-templates/src/__name__-plugin.ts:71` — `manifest: __name__AdapterManifest`
- `scripts/create-adapter-templates/src/__name__-plugin.ts:79` — commented example: `__name__AdapterManifest.adapterKey`
- `scripts/create-adapter-templates/src/__name__-plugin.ts:83` — commented example: same
- `scripts/create-adapter-templates/src/index.ts:17` — `__name__AdapterManifest,` (re-export)
- `scripts/create-adapter-templates/src/index.ts:19` — `} from './__name__-plugin';` ← this one is the FILENAME path (correct as `__name__`, stays put)

So 5 of the 6 positions need a token change. (Position 19 is a path string, stays `__name__`.)

### Existing convention

`libs/integrations/allegro/src/allegro-plugin.ts:72` — `export const allegroAdapterManifest`.
`libs/integrations/prestashop/src/prestashop-plugin.ts:55` — `export const prestashopAdapterManifest`.

Convention is **camelCase identifier** (`<camelName>AdapterManifest`). For hyphenated `smoke-test` the expected identifier is `smokeTestAdapterManifest`.

### Existing safety net

- `scripts/check-create-adapter.mjs` already does shape + token-leftover + count checks at lint-time (header says "#684, partial"). Today it scaffolds **one** slug (`lintcheck`, non-hyphenated), so the bug class slipped through.
- `.github/workflows/scaffold-smoke.yml` (PR #695) does the full `tsc -b` smoke in CI, also on a non-hyphenated slug (`smoketest`). Updating it to hyphenated is the second safety net.

---

## 3 — Design

### Token change

Introduce a fourth substitution token:

| Token | Form | Example for `smoke-test` |
|---|---|---|
| `__camelName__` | lowerCamelCase | `smokeTest` |

Same `split-hyphen → PascalCase parts → join` derivation as `toPascalCase`, but with the first character of the FIRST part left lowercase.

```js
function toCamelCase(slug) {
  const parts = slug.split('-');
  return parts
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('');
}
```

For non-hyphenated slugs (`shopify`), `__camelName__` resolves to the same value as `__name__` (`shopify`). No regression — existing in-tree usage of `__name__` in identifier positions only ever ran against non-hyphenated slugs.

### Template edits

Replace the 5 identifier-position occurrences of `__name__AdapterManifest` with `__camelName__AdapterManifest`. Leave the path-string occurrence at `index.ts:19` alone.

After substitution for `smoke-test`:
```ts
// __name__-plugin.ts → smoke-test-plugin.ts
export const smokeTestAdapterManifest: AdapterMetadata = { ... };
//          ^^^^^^^^^ — identifier, valid
```

### Drift guard

Extend `scripts/check-create-adapter.mjs` to scaffold **two** slugs per run:

1. `lintcheck` (existing, non-hyphenated — keeps the trivial sanity check)
2. `smoke-test` (new, hyphenated — exercises the camelName path)

Both runs go through the same assertion suite (shape + token-leftover + count). The token-leftover check picks up `__camelName__` as a fourth must-be-substituted token.

This locks in the bug class: if anyone ever reintroduces `__name__AdapterManifest` in a template, the hyphenated-slug run will produce a file containing `smoke-testAdapterManifest`, and either:
- the new check-create-adapter assertion will spot the `-` in the file contents via a (light) syntax check, OR
- (defense in depth) the CI `scaffold-smoke.yml` will catch it via real `tsc -b`.

The simpler win is just covering the hyphenated path — the existing token-leftover check doesn't catch this regression (`__name__` is correctly substituted; the problem is *where* it was substituted to). Adding a quick "no `-` in TS identifier positions" smoke is more brittle than valuable. The lint shape check + the CI tsc smoke together cover the bug class, with the CI smoke being the authoritative compile check.

### CI workflow update (optional)

`.github/workflows/scaffold-smoke.yml` currently scaffolds the non-hyphenated `smoketest`. Bumping to `smoke-test` makes the CI smoke exercise the hyphenated code path on every relevant PR. Low-risk edit (one slug change in the workflow file).

---

## 4 — Implementation steps

### Step 1 — Add `__camelName__` token to scaffolder

**File:** `scripts/create-adapter.mjs`

- Add `toCamelCase(slug)` helper next to `toPascalCase`.
- Extend the `tokens` object in `scaffoldAdapter` to include `camelName: toCamelCase(name)`.
- Extend `applyTokens` to substitute `__camelName__` → `tokens.camelName`.

**Acceptance:** running `node scripts/create-adapter.mjs --help` still works; the token list in the file's header docblock is updated to list four tokens.

### Step 2 — Update templates to use `__camelName__` in identifier positions

**Files:**
- `scripts/create-adapter-templates/src/__name__-plugin.ts` (4 positions)
- `scripts/create-adapter-templates/src/index.ts` (1 position; the path-string at `:19` stays)

**Acceptance:** scaffolding `smoke-test` with the new scaffolder produces `libs/integrations/smoke-test/src/smoke-test-plugin.ts` containing `export const smokeTestAdapterManifest`, and `src/index.ts` containing `smokeTestAdapterManifest,` in the re-export block.

### Step 3 — Extend check-create-adapter.mjs to cover hyphenated slug

**File:** `scripts/check-create-adapter.mjs`

- Hoist the per-slug logic into a function `runScaffoldCheck(slug)` that does the existing scaffold + shape + token-leftover + count checks.
- Call it twice: once with `'lintcheck'`, once with `'smoke-test'`.
- Add `__camelName__` to the `TOKENS` must-be-substituted list.
- Update `applyExpectedSubstitution` to apply `__camelName__` substitution (mirroring the scaffolder).
- The `EXPECTED_FILE_COUNT` constant stays at 14 — the file count is per-run, identical for both slugs.
- The OK-line summary becomes `check-create-adapter: OK (2 slugs × 14 files)` to make the doubled coverage visible.

**Acceptance:** `pnpm lint` includes a check-create-adapter step that exits 0 on a clean tree; if the camelName substitution is broken (e.g. a future PR replaces `__camelName__` with `__name__` in an identifier position), the second slug's run produces a file with a `-` in the identifier and the token-leftover or extended sanity check fails. Pre-commit budget impact: ~2× sub-second (still well under the lint budget).

### Step 4 — CI workflow: switch to hyphenated slug

**File:** `.github/workflows/scaffold-smoke.yml`

- Change the scaffold slug from `smoketest` to `smoke-test`.
- Verify the workflow's existing `pnpm --filter @openlinker/integrations-<slug> build` invocation still resolves with the new slug.

**Acceptance:** workflow YAML still parses; the slug appears only in the script-block and the cleanup step. (Verifying the workflow runs green is a post-merge concern — the workflow's `pull_request` trigger means the PR for THIS work will run it as its own validation.)

### Step 5 — Docs touch-up

**File:** `scripts/create-adapter.mjs` header docblock.

Add `__camelName__` to the 3-token list in the header comment. Update the contents of any inline help that lists tokens (currently the header is the only such surface).

**File:** `docs/plugin-author-guide.md`

Scan for any mention of the template token set. If the guide enumerates `__name__` / `__Name__` / `__BRAND__`, add `__camelName__` to the list. (If the guide refers only to the slug → output transformation conceptually, no edit needed.)

### Step 6 — Local smoke

- `node scripts/create-adapter.mjs smoke-test --target-dir /tmp/scaffold-698-check`
- `cd /tmp/scaffold-698-check/smoke-test && grep -n smokeTestAdapterManifest src/smoke-test-plugin.ts src/index.ts` — both files should print the identifier.
- `pnpm --filter @openlinker/integrations-smoke-test build` (after symlinking into the workspace) — should compile. *(Skipped if the workspace symlink dance is fragile — the CI `scaffold-smoke.yml` re-run on the resulting PR is the authoritative check.)*

---

## 5 — Validation

### Architecture compliance

DX / tooling layer only. No CORE ↔ Integration boundary crossings, no runtime code, no DI wiring, no domain logic. The `scripts/` directory is the established home for these invariants (4 sibling scripts: `check-design-tokens.mjs`, `check-migration-timestamps.mjs`, `check-render-template-fixture-drift.mjs`, `check-create-adapter.mjs`).

### Naming compliance

`toCamelCase` matches the existing `toPascalCase` convention. `__camelName__` matches the existing token style (`__name__` / `__Name__` / `__BRAND__`). No new file names introduced.

### Testing strategy

The lint-time `check-create-adapter` itself IS the test for the scaffolder. Running it against a hyphenated slug is the regression coverage. No `*.spec.ts` needed — `scripts/` is not under Jest's test glob.

### Security

No new attack surface. The scaffolder writes to `targetDir` (default `libs/integrations/`); `--target-dir` already supports tmp-dir override. No shell-out, no file ops outside the tree.

### Risks

- **Risk:** unforeseen template position using `__name__` in an identifier slot we missed. **Mitigation:** Step 3 adds the hyphenated-slug coverage; any miss would fail the lint check on this PR's own run.
- **Risk:** the CI workflow change in Step 4 conflicts with concurrent edits to `scaffold-smoke.yml`. **Mitigation:** `git fetch origin main` immediately before commit; the workflow file has no other open PR touching it.
- **Risk:** `pnpm install` warns on the changed package.json (none expected — we don't touch package.json). **Mitigation:** none needed; quality gate would catch.

---

## 6 — Open questions

- **Close #684?** Its original ask was tsc-noEmit in lint. That was explicitly deferred and shipped as CI in #695. The shape check is already in main. After this PR adds hyphenated coverage, #684 is functionally complete — its full scope (drift guard for scaffolder output) is satisfied between the lint shape check + CI tsc smoke + hyphenated-slug coverage. Recommendation: include `Closes #684` in the PR body alongside `Closes #698`. If the user wants tsc-noEmit moved back into lint anyway, that's a separate follow-up that explicitly diverges from the #695 design decision.
- **Bump `EXPECTED_FILE_COUNT` to count both runs?** The count is per-run, and asserting `14` twice is cleaner than asserting `28` once. Plan keeps it as-is — per-run, single constant.

---

## File list

| File | Action | Reason |
|---|---|---|
| `scripts/create-adapter.mjs` | edit | Add `__camelName__` token + helper |
| `scripts/create-adapter-templates/src/__name__-plugin.ts` | edit | 4 identifier positions → `__camelName__` |
| `scripts/create-adapter-templates/src/index.ts` | edit | 1 identifier position → `__camelName__` |
| `scripts/check-create-adapter.mjs` | edit | Cover hyphenated slug + `__camelName__` in TOKENS |
| `.github/workflows/scaffold-smoke.yml` | edit | Hyphenated slug in CI smoke |
| `docs/plugin-author-guide.md` | maybe-edit | If token list is enumerated |
| `docs/plans/implementation-plan-698-684-adapter-scaffolder-hyphens.md` | new | This plan |
