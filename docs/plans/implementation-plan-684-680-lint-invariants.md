# Implementation Plan — #684 + #680: Lint invariants for scaffolder + plugin-author-guide quotes

**Branch**: `684-680-lint-invariants`
**Status**: Draft — pending user sign-off

Two `scripts/check-*.mjs` invariant scripts that close out the drift-risk gaps surfaced by the tech-reviews on the previous two PRs (#681, #685). Both are wired into the existing `pnpm lint` chain via `check:invariants`. Same shape as `check-design-tokens.mjs`, `check-migration-timestamps.mjs`, `check-render-template-fixture-drift.mjs`.

Closes:

- **#680** — `docs/plugin-author-guide.md` verbatim quotes + line-range references stay in sync with the source (full coverage of what the issue asks for).
- **Partial close on #684** — the shape-only check this PR ships catches token-substitution and file-shape drift but **not** the tsc-compile drift the issue body asks for. The full tsc smoke is filed as a new follow-up issue at PR-creation time; #684 is closed with a comment explaining the reduced scope. See the framing in § 1 *Goals & non-goals* below.

---

## 1. Goals & non-goals

### Goals

1. Catch silent drift in `scripts/create-adapter.mjs` + `scripts/create-adapter-templates/` before it reaches a contributor. Specifically: template tokens not substituted, expected file shape changing, template-file count drifting.
2. Catch silent drift in `docs/plugin-author-guide.md`'s three pinned source references — the verbatim `CoreCapabilityValues` block at lines 22-28 of `adapter.types.ts`, and the line-range pointers at `adapter-plugin.ts:42-110` and `host-services.ts:50-121`.
3. Both checks chain into `pnpm lint` via `check:invariants` and run sub-second so they're acceptable in the pre-commit hook.
4. Self-documenting failure messages — when the invariant fires, the contributor reads the error and knows what to fix.

### Non-goals (deferred to follow-ups)

- **Full `tsc --noEmit` smoke on scaffolded output.** The original #684 framing called for compiling the scaffold to confirm it still type-checks against the current workspace. Doing this in `pnpm lint` requires either (a) scaffolding into `libs/integrations/` + running `pnpm install --filter` + `tsc -b` (~10-15s — bad pre-commit UX), or (b) writing a synthetic `tsconfig.json` with `paths` overrides to resolve `@openlinker/*` to source. Both add meaningful complexity. The shape check (this PR) catches the most common drift; the heavier compile check belongs in a separate non-blocking CI job (e.g., `pnpm verify:scaffold` chained off a GitHub Actions workflow but not `pnpm lint`).
  - **Issue hygiene**: per project memory, issues only close via merged PR with `Closes #N`. This PR's body uses **`Closes #680` only**. #684 stays open — its body explicitly asks for the tsc smoke, which this PR doesn't ship. The PR body links to #684 with a "partial-coverage" note explaining what's shipped vs what's still pending, plus a link to the new follow-up issue filed at PR-creation time. A future PR that adds the tsc check will be the one to close #684.
- Generalized "verify every file path mentioned in the guide" check. Out of scope; the three pinned references are the load-bearing ones.
- Anchor-link verification (`#L22-L28` rendering correctly on GitHub blob view). Best-effort by design.

---

## 2. Layer classification

**DX / repo tooling.** Two new `.mjs` scripts under `scripts/`. No CORE, Integration, Interface, Frontend, or schema changes.

Files touched:
- `scripts/check-create-adapter.mjs` (new, ~80 LOC)
- `scripts/check-plugin-guide-quotes.mjs` (new, ~120 LOC)
- `package.json` (root) — chain both into `check:invariants`

---

## 3. Research summary

### Existing invariant-script conventions

Surveyed `scripts/check-design-tokens.mjs`, `check-migration-timestamps.mjs`, `check-render-template-fixture-drift.mjs`. All share:

- Node ESM, `node:` imports only, no external deps.
- Top-of-file JSDoc block documenting the invariant and why it exists.
- `fileURLToPath(import.meta.url)` + `dirname` + `resolve` to find the repo root.
- Exit 0 on green; exit 1 on drift with a one-line-per-violation report to stderr.
- Sub-second runtime (verified earlier in `pnpm lint` output: `design-tokens: OK (85 tokens)`).
- Wired into `check:invariants` chain in root `package.json`.

The two new scripts follow this template exactly.

### What the plugin-author guide actually quotes

`grep -n "adapter.types.ts:\|adapter-plugin.ts:\|host-services.ts:" docs/plugin-author-guide.md` returns five lines, three distinct source references:

1. **Line 71**: `adapter.types.ts:22-28` — followed by a fenced TypeScript code block that **verbatim quotes** `CoreCapabilityValues`. This needs a character-for-character match check.
2. **Line 427**: `adapter-plugin.ts:42-110` — pointer only, no inline code. Prose describes the four fields. This needs a **boundary check**: lines 42-110 in the source must still bracket the `AdapterPlugin` interface body.
3. **Line 443**: `host-services.ts:50-121` — pointer only, no inline code. Prose describes the read-inputs vs side-registries split. Same boundary check as (2).

Plus two duplicate pointer references at lines 841, 843 (in the "Related reading" footer). Those re-reference the same ranges; the check normalizes by `(path, range)` so each unique reference is verified once.

### Scaffolder template inventory

`find scripts/create-adapter-templates -type f` returns **14 files** today. Token shape: `__name__`, `__Name__`, `__BRAND__` (no `__NAME__` — dropped during tech-review of #685). `scaffoldAdapter` is exported from `scripts/create-adapter.mjs` precisely so a smoke test can call it without re-parsing argv.

---

## 4. Design

### `scripts/check-create-adapter.mjs`

**Behavior**:

1. Import `scaffoldAdapter` from `scripts/create-adapter.mjs` (already exported).
2. Create a tmp dir at `os.tmpdir() + '/openlinker-create-adapter-check-' + process.pid + '-' + Date.now()`.
3. Call `scaffoldAdapter({ name: 'lintcheck', targetDir: tmpDir })`.
4. Assertions:
   - **Expected file list**: the scaffolder produces exactly the set of paths derived from `scripts/create-adapter-templates/` with `__name__/__Name__/__BRAND__` substituted. Build the expected list by walking the templates dir; mismatch fails with a diff.
   - **No leftover tokens**: every file in the output is grep-clean of `__name__`, `__Name__`, `__BRAND__`. Catches the substitution-forgotten-a-spot bug.
   - **Template count sanity**: expected file count constant (`EXPECTED_FILE_COUNT = 14`) — fails if a template was added without the constant bump, signaling "verify the scaffolder still works end to end" to the author.
5. Tmp dir cleanup in a `finally` block via `rm -rf` (via `fs.rm({ recursive: true, force: true })`).

**Validates**:
- Token-substitution bugs (most common drift surface).
- File-shape drift (template added but scaffolder doesn't pick it up, or vice versa).

**Does NOT validate** (out of scope, see §1):
- Output still compiles with `tsc -b`.
- Output still passes `eslint`.
- The reference adapter (PrestaShop) and the scaffolder output match structurally.

**Expected runtime**: <500ms (just filesystem + string ops).

**Failure-output format** (matches existing invariants):

- On success: `check-create-adapter: OK (<N> files)` to stdout, exit 0.
- On missing-file: `check-create-adapter: expected file missing from scaffolder output: <relpath>` to stderr.
- On unexpected-file: `check-create-adapter: unexpected file in scaffolder output (not in templates dir): <relpath>` to stderr.
- On count mismatch: `check-create-adapter: file count mismatch — expected <N>, got <M> (bump EXPECTED_FILE_COUNT after verifying)` to stderr.
- On token leftover: `check-create-adapter: substitution token "<tok>" leaked into output file: <relpath>` to stderr.
- Each failure exits 1 immediately. One-line-per-violation matches `check-design-tokens.mjs`.

### `scripts/check-plugin-guide-quotes.mjs`

**Behavior**:

1. Read `docs/plugin-author-guide.md` into memory.
2. **Verbatim block check** for `CoreCapabilityValues`:
   - Extraction algorithm (sketch, written explicitly so the next maintainer doesn't pick a different one):
     ```
     lines = guide.split('\n');
     linkIdx = lines.findIndex(l => l.includes('adapter.types.ts:22-28'));
        // fail if -1: "guide is missing the CoreCapabilityValues reference"
     fenceStartIdx = lines.findIndex((l, i) => i > linkIdx && l.startsWith('```typescript'));
        // fail if -1 or if (fenceStartIdx - linkIdx > 5):
        //   "expected a typescript fence within 5 lines of the reference"
        // The 5-line cap defends against a refactor inserting an unrelated
        // paragraph between the link and the fence; without it the script
        // could pair the wrong fence and silently accept drift.
     fenceEndIdx = lines.findIndex((l, i) => i > fenceStartIdx && l === '```');
     quotedBlock = lines.slice(fenceStartIdx + 1, fenceEndIdx).join('\n');
     ```
   - Read lines 22-28 of `libs/core/src/integrations/domain/types/adapter.types.ts` from disk.
   - Compare line by line (after trimming trailing whitespace + dropping a single trailing newline on each side).
   - Mismatch → exit 1 with the first divergent line printed side-by-side.
3. **Line-range boundary check** for `AdapterPlugin` and `HostServices`:
   - For each of the two references (`adapter-plugin.ts:42-110`, `host-services.ts:50-121`):
     - Read the file from disk.
     - Verify line `<start>` matches `^export interface <Name> {` (where `<Name>` is `AdapterPlugin` / `HostServices`).
     - Verify line `<end>` matches `^}\s*$` (closing brace of the interface, no trailing content).
   - Mismatch → exit 1 with the actual line content vs expected pattern.
4. All three reference paths must resolve on disk (otherwise the guide is referencing a moved file).

**Validates**:
- `CoreCapabilityValues` quote stays accurate as the codebase changes.
- The `AdapterPlugin` interface still starts at line 42 and ends at line 110 — fails the moment someone adds an import above the interface or extends it past line 110.
- `HostServices` same shape.

**Does NOT validate**:
- The four field-bullet prose at lines 431-439 of the guide (e.g., "register?(host: HostServices): void — optional"). That prose summarizes the interface; if the interface adds a fifth field, the boundary check fires (end line moves), but the prose drift isn't structurally caught. Acceptable for v1 — the boundary catch forces the human to re-read the prose anyway.

**Expected runtime**: <100ms (one markdown read + three small source reads).

**Failure-output format** (matches existing invariants):

- On success: `check-plugin-guide-quotes: OK (1 verbatim block, 2 boundary references)` to stdout, exit 0.
- Verbatim mismatch: `check-plugin-guide-quotes: CoreCapabilityValues quote drift — line <n>: source="<x>" guide="<y>"` to stderr.
- Boundary miss (start): `check-plugin-guide-quotes: <file>:<start> does not match expected "export interface <Name> {" (found: "<actual>")` to stderr.
- Boundary miss (end): `check-plugin-guide-quotes: <file>:<end> does not match expected closing "}" (found: "<actual>")` to stderr.
- Missing reference in guide: `check-plugin-guide-quotes: guide is missing reference to <file>:<range>` to stderr.
- Each failure exits 1 immediately.

### Wire-up

Root `package.json` — extend `check:invariants`:

```jsonc
"check:invariants": "bash scripts/check-fixture-purity.sh && node scripts/check-render-template-fixture-drift.mjs && node scripts/check-migration-timestamps.mjs --self-check && node scripts/check-migration-timestamps.mjs && node scripts/check-design-tokens.mjs && node scripts/check-create-adapter.mjs && node scripts/check-plugin-guide-quotes.mjs"
```

Append at the end of the chain; same shape as the existing entries.

---

## 5. Implementation steps

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `scripts/check-create-adapter.mjs` | Create | Node ESM. Imports `scaffoldAdapter` from `./create-adapter.mjs`. Scaffolds to `os.tmpdir()`. Asserts (a) expected file list, (b) no leftover tokens, (c) expected file count. Cleanup in `finally`. Exits 0 on green, 1 on drift. ~80 LOC |
| 2 | `scripts/check-plugin-guide-quotes.mjs` | Create | Node ESM. Reads the guide. Verbatim-block check for `CoreCapabilityValues`. Boundary check for `AdapterPlugin` (lines 42-110) + `HostServices` (lines 50-121). Exits 0/1 with descriptive messages. ~120 LOC |
| 3 | `package.json` (root) | Edit | Append `&& node scripts/check-create-adapter.mjs && node scripts/check-plugin-guide-quotes.mjs` to the `check:invariants` script |
| 4 | **Manual smoke** | Run | `pnpm lint` from worktree root; confirm both new invariants pass. Then deliberately break each (e.g., add a trailing space inside a template, or shift the `AdapterPlugin` start by one line in a scratch checkout) and confirm the right error fires. Revert |

---

## 6. Validation strategy

### Cost-benefit framing for the deferred tsc smoke

The shape-only check catches token-substitution + file-shape drift in <500ms. The full `tsc --noEmit` smoke would additionally catch drift from core API renames (e.g., a port moving from one `@openlinker/core/<ctx>` barrel to another) — but costs ~15× the lint budget (~10-15s for the scaffold + install + tsc round-trip). Pre-commit UX dominates: existing invariants all run sub-second; bumping `pnpm lint` to 12+ seconds across the board to catch a less-common drift class is the wrong trade. Accept the gap, file the full check as a non-blocking CI follow-up.

### Architecture compliance

DX tooling — no architecture surface touched. Hexagonal architecture unaffected.

### Naming

- Both files use the `check-<topic>.mjs` pattern matching existing invariants.
- No symbols to name; just scripts.

### Testing strategy

**Neither script ships with a unit test.** Same rationale as the scaffolder itself:

1. The scripts are exercised every `pnpm lint` (which runs `check:invariants`). That's strong continuous coverage.
2. The scripts have very low logic complexity — a regex extraction, a file read, a string compare. Edge cases are tested by the deliberate-break smoke during PR development.
3. Adding a test runner under `scripts/` (where no tests live today) introduces infra cost without commensurate benefit.

If a regression slips through, the fix is a one-line tweak to the script — no test fixture overhead.

### Security

- Both scripts read files only (no writes outside `os.tmpdir()`).
- Tmp dir name includes `process.pid + Date.now()` to defend against name collisions.
- `fs.rm({ recursive: true, force: true })` is fenced inside `finally` so partial failures don't leave artifacts in `os.tmpdir()`.
- No external network calls, no shell-out to user-controlled strings.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Line-range boundary check is brittle to legitimate refactors (e.g., merging a one-line comment into the interface body shifts the end line) | Medium | The mitigation IS the check firing — the human update the guide's `:42-110` reference to match the new range. That's exactly the drift the invariant exists to catch. |
| Verbatim-block check could false-positive on a whitespace-only diff | Low | Compare after `.trimEnd()` on each line + drop one trailing newline. Catches semantic diffs, ignores trailing-whitespace churn. |
| Tmp-dir leak if the script process is `SIGKILL`'d between scaffold and cleanup | Low | `os.tmpdir()` is OS-cleaned periodically. Tmp dir names are unique-per-invocation. Worst case: orphaned ~150KB per killed run. |

### Open questions

None blocking.

---

## 7. Out of scope

- **Full tsc smoke** on scaffolded output. Documented as a known gap; tracked at PR-creation time as a follow-up issue.
- **Verifying every linked path in the guide** (47+ paths). Different drift profile (link rot vs source rename) and out of scope here. Worth a separate `scripts/check-doc-links.mjs` someday.
- **Prose drift between the guide's field bullets and the interface body**. The boundary check catches the boundary; the human re-reads the prose. Structural prose-vs-source checking would require parsing TS, which is over-engineered for this layer.

---

## 8. PR shape

Single PR. Commit grouping: one commit. Conventional-commit prefix `chore(dx)` since these are dev-experience invariants.

**PR body**:
- `Closes #680` — full coverage of what the issue asks for.
- **No `Closes #684`.** The PR ships partial coverage of #684 (shape, not compile); the full tsc smoke is a follow-up. Per project memory, issues only close via the merged PR that fully satisfies them. PR body explicitly links #684 with a "partial coverage shipped — see follow-up #X" note. A new follow-up issue is filed at PR-creation time and referenced in the body alongside the partial-coverage note.

Expected diff stat: ~250 LOC added across 2 new script files + 1 line in `package.json`. Zero deletions.
