# Implementation Plan: WooCommerce Branch Rebase & Merge Conflict Resolution

**Date**: 2026-06-03  
**Status**: Ready for Execution  
**Estimated Effort**: 2–4 hours (mostly automated via parallel subagents)

---

## 1. Task Summary

**Objective**: Rebase all 7 WooCommerce feature branches onto current `origin/main` (42 commits ahead), resolve any merge conflicts, clean stray files, and force-push the rebased branches.

**Context**: All WooCommerce PRs (#947, #958, #959, #960, #969, #970, #972) were created when `main` was at a specific SHA. Main has since received 42 commits (orders redesign, shipping work, plugin-sdk updates, shared lib changes). The review-fix session has already committed fixes to all 7 branches. They now need to be rebased to be merge-ready.

**Classification**: DX / Infrastructure (git history, no business logic changes)

---

## 2. Scope & Non-Goals

### In Scope
- Rebase each of the 7 branches onto their correct base (main or parent branch)
- Resolve any merge conflicts that arise — favouring WC branch's intent when conflicts are in WC-specific files, favouring `main` for shared files (plugin-sdk, package.json) and then re-applying WC's additions on top
- Clean the stray untracked file in worktree 877 (`docs/plans/implementation-plan-877-woocommerce-order-processor.md`)
- Force-push all rebased branches using `--force-with-lease`

### Out of Scope
- Any new feature work or additional fixes
- Merging PRs (Piotr's decision)
- Running integration tests (out of scope per user constraint)

### Constraints
- `--no-verify` on any merge-conflict resolution commits
- Quality gate: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` only
- `--force-with-lease` for all pushes (safe for personal feature branches)
- Do NOT touch `main`

---

## 3. Architecture Mapping

**Target Layer**: None (pure git operations) — no source code is being authored, only conflicts resolved to keep existing WC code working against updated shared infrastructure.

**Files most likely to conflict** (changed in both main and WC branches):
- `libs/plugin-sdk/src/create-nest-adapter-module.ts` — main updated it; WC 873 uses `createNestAdapterModule`
- `libs/plugin-sdk/src/host-services.ts` — main added auth-failure registry (#819); WC plugins use `HostServices`
- `package.json` — main updated workspace; WC branches added `@openlinker/integrations-woocommerce`
- `libs/shared/package.json` — main updated shared deps
- `docker-compose.yml` — 878 adds WC services; main may have touched it
- `apps/api/src/database/data-source.ts` — entity glob changes possible

**Conflict resolution strategy**:
- For shared infrastructure files (`plugin-sdk`, `package.json`, `libs/shared`): take **main's version** as the base, then re-apply WC-specific additions on top (e.g., WoocommerceIntegrationModule in plugins.ts, WC service in docker-compose)
- For WC-specific files (`libs/integrations/woocommerce/**`): always take **WC branch version** (ours)
- For test config files (`jest*.js`, `tsconfig*.json`): take **main's version** and re-add WC module mapper if present in WC branch

---

## 4. Branch State & Rebase Order

```
Current state (2026-06-03):
  873  ahead=3   behind=42  (base: main)
  874  ahead=5   behind=42  (base: main)
  875  ahead=11  behind=0   (base: 879, which is behind 874)
  876  ahead=9   behind=0   (base: 874, which is behind main)
  877  ahead=14  behind=1   (base: 875, which is 0 behind 879)
  878  ahead=11  behind=42  (base: main)
  879  ahead=7   behind=0   (base: 874, which is behind main)
```

**Rebase wave order (dependency graph)**:

```
Wave 1 (parallel — all direct children of main):
  873 → rebase onto origin/main
  874 → rebase onto origin/main
  878 → rebase onto origin/main

Wave 2 (parallel — both children of 874, after Wave 1):
  879 → rebase onto 874-woocommerce-product-master-read (local, now updated)
  876 → rebase onto 874-woocommerce-product-master-read (local, now updated)

Wave 3 (sequential — child of 879, after Wave 2):
  875 → rebase onto 879-woocommerce-product-master-write (local, now updated)

Wave 4 (sequential — child of 875, after Wave 3):
  877 → rebase onto 875-woocommerce-inventory-master-port (local, now updated)

Wave 5 (parallel — push all):
  force-push all 7 branches
```

---

## 5. Worktree Reference

| Branch | Worktree Path |
|---|---|
| 873 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/873-woocommerce-plugin-scaffold` |
| 874 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/874-woocommerce-product-master-read` |
| 875 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/875-woocommerce-inventory-master` |
| 876 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/876-woocommerce-order-source` |
| 877 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/877-woocommerce-order-processor` |
| 878 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/878-woocommerce-e2e-docker` |
| 879 | `/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/879-woocommerce-product-master-write` |

---

## 6. Detailed Implementation Plan

### Pre-flight (before waves)

**Step 0.1 — Clean 877 worktree**
- Delete `docs/plans/implementation-plan-877-woocommerce-order-processor.md` from worktree 877
- This is a stray file; removing it avoids it being committed during rebase conflict resolution
- Command: `rm /home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/877-woocommerce-order-processor/docs/plans/implementation-plan-877-woocommerce-order-processor.md`

**Step 0.2 — Fetch latest main**
- Run `git fetch origin` from main worktree to ensure `origin/main` is current
- Command: `git -C /home/nor/projekty/blocky/openlinker-pnpm-10 fetch origin`

---

### Wave 1 — Rebase 873, 874, 878 onto main (parallel)

Each agent receives its worktree path and does:
1. `git fetch origin`
2. `git rebase origin/main`
3. If conflicts: for each conflicted file, resolve using the strategy in §3; stage resolved files; `git rebase --continue` with `--no-verify`
4. Quality gate: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`
5. If gate passes: done (no extra commit needed — rebase already rewrote history)
6. Report: success/failure, conflicts encountered, files resolved

**Conflict guidance per file type**:
- `libs/plugin-sdk/src/create-nest-adapter-module.ts`: take main's version (`git checkout --theirs <file>`), but verify WC plugin still compiles (check if API changed)
- `libs/plugin-sdk/src/host-services.ts`: take main's version, verify `HostServices` interface is still compatible with WC plugin usage
- `package.json` / `libs/shared/package.json`: take main's version (`git checkout --theirs`), then manually re-add WC workspace entry if main's version removed it
- `docker-compose.yml` (878 only): take main's version as base, then manually re-add WC + WC-MySQL service definitions that 878 introduced
- `apps/api/src/plugins.ts` / `apps/worker/src/plugins.ts` (873 only): merge both sides — keep main's additions AND 873's WoocommerceIntegrationModule addition

---

### Wave 2 — Rebase 879 and 876 onto updated 874 (parallel)

879 and 876 both target `874-woocommerce-product-master-read` as their base. Since 874 was just rebased (its local SHA changed), 879 and 876 need to rebase onto the updated local 874 tip.

1. `git rebase 874-woocommerce-product-master-read` (local branch, already updated)
2. Resolve conflicts if any (same strategy as Wave 1)
3. Quality gate: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`

---

### Wave 3 — Rebase 875 onto updated 879

875 targets `879-woocommerce-product-master-write`. After Wave 2 rebased 879, 875 needs to follow.

1. `git rebase 879-woocommerce-product-master-write` (local, updated)
2. Resolve conflicts (focus: any `woocommerce-plugin.ts` or product-master adapter conflicts from the previous review-fix commits that may have touched overlapping lines)
3. Quality gate: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`

---

### Wave 4 — Rebase 877 onto updated 875

877 has 1 commit behind 875 (the SSRF fix). After Wave 3 rebased 875, 877 needs to rebase onto it.

1. `git rebase 875-woocommerce-inventory-master-port` (local, updated)
2. Resolve conflicts — the most likely conflict is in `woocommerce-plugin.ts` or shared adapter files touched by both the 875 review-fix and 877's own commits
3. Quality gate: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`

---

### Wave 5 — Force-push all branches

After all rebases are complete, push all 7 branches. Requires SSH key to be loaded.

```bash
git -C .claude/worktrees/873-woocommerce-plugin-scaffold push --force-with-lease origin 873-woocommerce-plugin-scaffold
git -C .claude/worktrees/874-woocommerce-product-master-read push --force-with-lease origin 874-woocommerce-product-master-read
git -C .claude/worktrees/879-woocommerce-product-master-write push --force-with-lease origin 879-woocommerce-product-master-write
git -C .claude/worktrees/876-woocommerce-order-source push --force-with-lease origin 876-woocommerce-order-source-port
git -C .claude/worktrees/875-woocommerce-inventory-master push --force-with-lease origin 875-woocommerce-inventory-master-port
git -C .claude/worktrees/877-woocommerce-order-processor push --force-with-lease origin 877-woocommerce-order-processor
git -C .claude/worktrees/878-woocommerce-e2e-docker push --force-with-lease origin 878-woocommerce-e2e-docker
```

If SSH key is not loaded, the push agent will detect the `Permission denied (publickey)` error and report it. User must run: `eval $(ssh-agent) && ssh-add ~/.ssh/id_ed25519` in their terminal.

---

## 7. Conflict Resolution Rules (Quick Reference)

| File | Strategy | Reason |
|---|---|---|
| `libs/plugin-sdk/src/*.ts` | `git checkout --theirs` → verify WC compatibility | Main added auth-failure registry (#819); WC code should adopt it |
| `package.json` | `git checkout --theirs` → re-add WC workspace if missing | Main has the authoritative workspace config |
| `libs/shared/package.json` | `git checkout --theirs` | Main owns shared deps |
| `docker-compose.yml` | `git checkout --theirs` → re-add WC+MySQL services | 878 added services that shouldn't be lost |
| `apps/api/src/plugins.ts` | Manual merge (keep both sides' additions) | Both main and 873 added entries |
| `apps/worker/src/plugins.ts` | Manual merge (keep both sides' additions) | Same |
| `libs/integrations/woocommerce/**` | `git checkout --ours` | WC code is always ours |
| `apps/api/test/integration/**` (878) | Manual merge | 878 adds WC int-spec helpers; main adds order int-specs |

---

## 8. Questions & Assumptions

### Assumptions
- SSH key is (or will be) loaded before Wave 5
- `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` is sufficient quality gate (no full repo tests)
- Git rebase in a git worktree correctly shares the `.git` directory with the main repo — local branch refs are visible to all worktrees
- The `HostServices` interface change in `host-services.ts` on main is additive (new registry property) — WC plugin's usage remains compatible

### Open Questions
- Does main's `host-services.ts` change break the WC plugin's `createWoocommercePlugin` function? The WC plugin builds a HostServices bag from injected fields — if new required fields were added to the interface, it will fail TypeScript compilation. **Assumption**: added fields are optional or the WC plugin uses spread/Partial — check at rebase time.
- Did main touch `docker-compose.yml`? Confirmed from diff: `docker-compose.yml` is NOT in the main diff — only `libs/plugin-sdk`, `libs/shared`, `package.json`, and FE plugin files changed. So 878's docker-compose additions should rebase cleanly.

---

## 9. Orchestration Model

Each wave uses separate subagents to keep context windows small:

- **Wave 1**: 3 parallel agents (873, 874, 878) — each agent reads only its own worktree
- **Wave 2**: 2 parallel agents (879, 876) — each agent reads only its own worktree; both rebase on the locally updated 874
- **Wave 3**: 1 agent (875)
- **Wave 4**: 1 agent (877)
- **Wave 5**: 1 agent (push all)

Each agent:
1. Runs rebase command
2. If conflicts: resolves using the file-type strategy above, stages, continues
3. Runs scoped quality gate
4. Reports outcome (rebased OK / conflicts found+resolved / quality gate failed)

---

## 10. Acceptance Criteria

- [ ] All 7 branches have `0 commits behind` their respective bases (main or parent branch)
- [ ] `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` passes in all 7 worktrees
- [ ] All 7 branches are force-pushed to `origin`
- [ ] 877 worktree has no untracked stray files
- [ ] No merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain in any tracked file
- [ ] All original WC feature commits are preserved (rebase, not merge — history is linear)

---

## 11. Alignment Checklist

- [x] No CORE boundary violations — pure git operations
- [x] No new abstractions introduced
- [x] Idempotent — rebase can be re-run if it fails midway (same result)
- [x] No schema changes — no migrations needed
- [x] Scoped quality gate — does not run full monorepo test suite
- [x] `--force-with-lease` — safe push that fails if someone else pushed to the branch
- [x] Plan is execution-ready

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md) — git workflow section
- Previous session plan: [implementation-plan-woocommerce-review-fix-session.md](./implementation-plan-woocommerce-review-fix-session.md)
