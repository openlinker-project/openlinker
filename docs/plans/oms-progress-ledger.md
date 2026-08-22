# OMS Programme Execution Ledger — Waves 0 → 2

**Branch**: `oms-programme-waves-0-2` (worktree `.claude/worktrees/oms-wave2-programme`).
**This file is the resume point.** A session continuing the programme reads this first, then the
wave epics (#2312 #2326 #2337 #2389) for per-issue detail. Update it after every issue completes
and commit it with the work.

## Owner decisions (2026-08-22, binding)

1. **Integration model**: one long-lived feature branch; per-issue work happens on short issue
   branches off it; the orchestrator merges them back after review. At each wave boundary run
   `/pr-review` over the wave's accumulated diff, apply all findings, then continue. PRs to `main`
   at wave boundaries; owner merges those.
2. **Spec §8 Q1 = YES** — automation v1 is in scope (W2-21…W2-29 stay).
3. **Severity rule (spec §4.3 ambiguity)**: decision-table row carries the fact's severity (red
   where nothing decides); the attention card is **always amber** (it is a to-do list). Fold into
   the spec when Wave-2 FE copy is first touched.
4. **#2289 spike method**: desk research against developer.allegro.pl (no sandbox credentials).
5. **Wave-2 FE pre-work**: #2435 (FormField single-child), #2436 (index.css token defects),
   #2299 (Dialog barrel) are scheduled before the Wave-2 FE children that hit them.

## Per-issue process (non-negotiable)

read spec/design refs → `/pre-implement` → plan (Opus) → `/tech-review` plan, apply ALL findings →
implement (Opus, on an issue branch off this branch) → quality gate (`pnpm lint && pnpm type-check
&& pnpm test`; `test:integration` when the slice warrants; `migration:show` on schema changes) →
`/tech-review` the diff, apply ALL findings → iterate until clean → orchestrator merges the issue
branch here → tick this ledger + the epic checklist. Fable orchestrates/reviews only; Opus produces
every line. Commits: `git commit -s`, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
Migration-bearing issues use synthetic-sequential timestamps (docs/migrations.md rule 3).

## Status

Legend: ☐ not started · ◐ plan in review · ◑ implementing · ◕ diff in review · ☑ merged to branch · ⛔ blocked

### Wave 0 (no epic)
| Issue | Subject | Status |
|---|---|---|
| #2282 | persistOrder source-attribution immutability | ☑ merged b91088599 (commit a5f59a370; reviewed, approved) |
| #2283 | ingestion line-diff + `amended` fact | ◑ implementing (READY; ANALYSIS-2283; scope = internal fact only, no union member; migration 1841000000000) |
| #2284 | `WHERE cancelledAt IS NULL` provisioning predicate | ☑ merged 4587122c9 (commit 99ab27462; reviewed, approved) |
| #2285 | `inv:{hash}` idempotency-key swap | ☑ merged 641e07bad (commit 97dfdf1d0; reviewed, approved) |
| #2286 | `never`-default exhaustiveness (5 consumers) | ☑ merged 9b48585b4 (commit 885b63f9e; reviewed, approved) |
| #2287 | `packedAt` BE | ☑ merged b6b06df76 (commit 943e0fa91; reviewed, approved) |
| #2288 | `packedAt` FE | ⛔ gate-cleared (ANALYSIS-2288: control OUT of capability-gated panel, orders:write); queued behind #2283 merge (shared timeline files) |
| #2289 | Allegro returns-feed spike → 1c fork | ☑ verdict 4A (two-pass); findings on branch + issue comment |

### Wave 1a (epic #2312) — gated on #2284 #2286 #2283 merged; #2298 resolved
### Wave 1b (epic #2326) — gated on #2285 merged; W1a-8 (#2308)
### Wave 1c (epic #2337) — gated on #2289 fork decided; Wave 1a
### Wave 2 (epic #2389) — gated per its epic body; §8 Q1 = YES (decision 2 above)

(Fill per-issue tables for each wave when its frontier opens; until then the epic checklist is the list.)

## Wave boundaries completed

(none yet)

## Resume instructions

1. `cd .claude/worktrees/oms-wave2-programme` (or EnterWorktree with that path); `git fetch origin`.
2. Read this ledger + `git log --oneline origin/main..HEAD` to see what landed.
3. If `node_modules` is missing: `pnpm install`, then `pnpm -r --filter "./libs/**" build`.
4. Continue the frontier: unblocked ☐ issues first, honoring the chains in
   `docs/plans/oms-backlog-overview.md` § Cross-wave critical paths.
5. At a wave boundary: `/pr-review` the wave diff, apply findings, merge `origin/main` in, open the
   wave PR to `main`, ask the owner to merge, and record it here.
