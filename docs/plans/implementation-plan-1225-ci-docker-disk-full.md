# Implementation Plan: CI — Fix Integration-Test Disk-Full on Self-Hosted Runner

**Date**: 2026-06-29
**Status**: Ready for Review
**Estimated Effort**: 0.5 h
**Issue**: [#1225](https://github.com/openlinker-project/openlinker/issues/1225)

---

## 1. Task Summary

**Objective**: Prevent the self-hosted runner's containerd working directory from exhausting disk space and blocking integration tests.

**Context**: `pnpm --filter @openlinker/worker test:integration` (and the API suite) fail intermittently with:

```
(HTTP code 500) server error – mkdir /var/lib/containerd/io.containerd.runtime.v2.task/moby/<hash>:
no space left on device
```

The runner accumulates Docker resources across CI runs: unused-but-tagged images (`postgres:16-alpine`, `redis:7-alpine`, successive `testcontainers/ryuk:*` version tags), stopped containers, build-cache layers, and anonymous volumes. Nothing in `.github/workflows/ci.yml` prunes these before the `test-integration` job runs.

**Classification**: DX / Infrastructure (CI) — zero production-code impact.

---

## 2. Scope & Non-Goals

### In Scope

- Add a Docker prune step to `.github/workflows/ci.yml` → `test-integration` job.
- The prune step must remove **unused tagged images** (not just dangling/untagged ones), because `postgres:16-alpine`, `redis:7-alpine`, and accumulating `testcontainers/ryuk:*` tags are the primary disk consumers and are not removed by `prune -f` alone.
- The prune step must also remove **anonymous volumes** and **stopped containers** (including those left by cancelled runs under `concurrency.cancel-in-progress: true`).

### Out of Scope

- Changing any source file, test harness, or TypeScript code.
- Adding a scheduled cleanup workflow (tracked as an optional follow-up in §6 Phase 2).
- Cleaning up `pnpm store` (separate concern, separate growth vector — not the containerd `no space left` path).
- Any change to the `lint`, `type-check`, `test`, `build`, or `test-php` jobs.

### Constraints

- Self-hosted runner is **dedicated** to this repo — no shared Docker workloads. Removing all unused images with `-a` is safe.
- The step must be unconditional (no `if:` guard) so it runs on every trigger.
- Placed **before `pnpm install`** so no build artifacts are written to disk before the free space is recovered.

---

## 3. Architecture Mapping

**Target Layer**: CI / DevOps (`.github/workflows/`) — no application layer involvement.

**Capabilities Involved**: None (infrastructure-only change).

**Existing Services Reused**: N/A.

**New Components Required**: One new YAML step in the `test-integration` job.

**Core vs Integration Justification**: Not applicable — this is a CI workflow file change.

---

## 4. Root Cause Analysis

### Why `docker system prune -f` alone is insufficient

`docker system prune -f` removes:
- Stopped containers
- Unused networks
- **Dangling** (untagged) images only
- Build cache

It does **not** remove unused-but-tagged images. On a self-hosted runner that has previously pulled `postgres:16-alpine`, `redis:7-alpine`, and N versions of `testcontainers/ryuk:*`, those images persist across every run. Only the `-a` / `--all` flag extends removal to all unused tagged images.

### Why `cancel-in-progress: true` makes it worse

```yaml
# ci.yml:18-20
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

When GitHub cancels a run mid-container-start (e.g. a push while Testcontainers is booting), containerd may hold a snapshot for the partially-started container. Docker can track the container as `created` (not `exited`); `docker system prune` removes `exited` containers but may miss `created`-state containers depending on Docker version. The `--volumes` flag is also needed to purge orphaned anonymous volumes that Ryuk fails to clean up when the process is killed.

### Primary disk consumers (ranked)

| Resource | Growth trigger | Cleared by |
|---|---|---|
| `testcontainers/ryuk:*` versioned tags | Every Testcontainers library upgrade | `prune -af` |
| Docker build cache | Every `docker build` on runner | `prune -f` |
| Stopped / created containers | cancelled runs, test teardown races | `prune -f` |
| Orphaned anonymous volumes | killed Ryuk / cancelled teardown | `volume prune -f` |
| `postgres:16-alpine`, `redis:7-alpine` | (same version stays; only accumulates on digest bumps) | `prune -af` |

---

## 5. Questions & Assumptions

### Open Questions

- None. The fix is self-contained and the runner is confirmed dedicated.

### Assumptions

1. The self-hosted runner runs no Docker workloads outside of this CI workflow. Removing all unused images with `-a` will not affect anything else.
2. Images pulled during the same CI run (`postgres:16-alpine`, `redis:7-alpine`, `ryuk`) are **in use** at the time Testcontainers starts them and will **not** be affected by the prune step placed before `pnpm install`.
3. `docker` and `docker volume` CLI are available on the runner (confirmed: the error references the Docker API, so Docker is installed).

### Documentation Gaps

- The `testing-guide.md` Troubleshooting section documents "Container Startup Timeout" but not the disk-full scenario. A sentence can be added there as a follow-up — out of scope for this PR.

---

## 6. Proposed Implementation Plan

### Phase 1 — CI Workflow Fix (the fix)

**Goal**: Add a `docker system prune -af` + `docker volume prune -f` step to the `test-integration` job before any install or build work.

**Step 1.1 — Add the prune step to `test-integration`**

- **File**: `.github/workflows/ci.yml`
- **Location**: After `uses: actions/checkout@v4` and before `uses: pnpm/action-setup@v2` (line 153–154 in the current file).
- **Action**: Insert the following step:

```yaml
      # Self-hosted runners accumulate Docker images, stopped containers,
      # anonymous volumes, and build-cache across CI runs. Prune before any
      # install so containerd has headroom to start Testcontainers containers.
      #
      # Flags:
      #   -a / --all  — removes *all* unused images, not just dangling ones.
      #                 Required: postgres:16-alpine, redis:7-alpine, and
      #                 accumulated testcontainers/ryuk:* version tags are
      #                 tagged (not dangling) and survive prune -f alone.
      #   -f          — skip the interactive confirmation prompt.
      #   volume prune -f — removes orphaned anonymous volumes left by
      #                 containers killed mid-teardown (cancel-in-progress).
      #
      # Safe on a dedicated runner (no shared Docker workloads).
      # Images will be re-pulled by Testcontainers; subsequent runs stay warm
      # because the images are already present by the time the next prune fires.
      - name: Prune Docker resources
        run: |
          docker system prune -af
          docker volume prune -f
```

- **Acceptance**: The step appears in the `test-integration` job, runs unconditionally, and precedes the `pnpm/action-setup` step.

**Step 1.2 — Verify no other job is changed**

- **Action**: Confirm that `lint`, `type-check`, `test`, `test-php`, and `build` jobs are untouched.
- **Acceptance**: `git diff` shows changes only inside the `test-integration` job's `steps:` block.

---

### Phase 2 — Optional Follow-Up: Scheduled Cleanup Workflow (deferred)

**Goal**: Prevent long-term drift even if the per-run prune is insufficient (e.g. disk fills mid-run due to a large PS Testcontainer boot).

This is **not part of this PR** — tracked as a follow-up to #1225.

Suggested approach: add `.github/workflows/runner-cleanup.yml` with a weekly `schedule` trigger running `docker system prune -af && docker volume prune -f` plus `pnpm store prune` on the self-hosted runner. This ensures the disk never accumulates even between CI runs.

---

## 7. Alternatives Considered

### Alternative A: `docker system prune -f` (issue's original proposal)

**Rejected because**: Does not remove tagged images (`postgres:16-alpine`, `redis:7-alpine`, `ryuk` versions). Disk pressure returns within N runs as new `ryuk` versions accumulate. This is the root cause of the "keeps coming back" behaviour.

### Alternative B: `docker image prune -af` only (skip volumes)

**Rejected because**: Does not remove orphaned anonymous volumes left by killed Ryuk instances under `cancel-in-progress: true`. Volumes consume inodes independently of image storage. `docker volume prune -f` adds ~1 s and is safe.

### Alternative C: Restart containerd/Docker daemon between runs

**Rejected because**: Requires `sudo` access and systemd on the runner, and kills any shared Docker state. Disproportionate to the problem. `prune` is sufficient.

### Alternative D: Move integration tests to GitHub-hosted (ephemeral) runners

**Rejected because**: GitHub-hosted runners are stateless and would fix the accumulation problem, but they are slower (no Docker layer cache), incur per-minute billing, and the decision to use self-hosted runners is outside this issue's scope.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ No application code changed — CI-only.
- ✅ No port, adapter, or domain boundary affected.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| First run after deploy re-pulls all images (slower) | Certain | One-time cost per runner; subsequent runs stay warm. Testcontainers already handles slow first-pull. |
| `docker volume prune -f` removes a volume in use by another job | Very low | Runner has no concurrent jobs (single-queue self-hosted). Pre-checkout placement makes it impossible for the same-run pnpm install to have created Docker volumes yet. |
| `prune -af` still insufficient (PS Testcontainer, ~1.5 GB) | Possible if disk is very small | Escalate to Phase 2 scheduled cleanup. The PS Testcontainer boots only in `apps/api/test/integration/prestashop/` specs — these are not part of `pnpm --filter @openlinker/worker test:integration`. |

### Edge Cases

- **Concurrent runs**: `cancel-in-progress: true` ensures at most one run per ref is active. The prune step runs at job-start before any Docker operations, so there is no concurrent Docker usage to disrupt.
- **Docker not available**: If Docker is missing, the step fails fast with a clear message (`docker: command not found`) — same failure mode as the Testcontainers boot itself. No regression.

### Backward Compatibility

- ✅ Fully backward-compatible. CI behaviour for all other jobs is unchanged.

---

## 9. Testing Strategy & Acceptance Criteria

Integration tests for this change are the CI run itself — there is no unit-testable artefact.

### Acceptance Criteria

- [ ] `.github/workflows/ci.yml` `test-integration` job contains a `docker system prune -af` + `docker volume prune -f` step placed before `uses: pnpm/action-setup@v2`.
- [ ] The step runs unconditionally (no `if:` guard).
- [ ] No other job in `ci.yml` (`lint`, `type-check`, `test`, `test-php`, `build`) is changed.
- [ ] Integration tests pass on the self-hosted runner after the fix (both API and worker suites).
- [ ] `git diff` shows changes only in the `test-integration.steps` block.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A (CI config only)
- [x] Respects CORE vs Integration boundaries — not applicable
- [x] Uses existing patterns — consistent with the "add step before install" pattern already used in `lint` job (fetch origin/main step)
- [x] Idempotency considered — `prune -af` is idempotent; running twice is a no-op
- [x] Event-driven patterns — not applicable
- [x] Rate limits & retries — not applicable
- [x] Error handling — Docker CLI exits non-zero on failure; GitHub Actions surfaces this automatically
- [x] Testing strategy — CI run is the acceptance test; no source code test coverage needed
- [x] Naming conventions — not applicable (YAML step names follow existing CI style)
- [x] File structure — single file change in `.github/workflows/`
- [x] Plan is execution-ready — yes

---

## Related Documentation

- [Testing Guide — Troubleshooting / Integration Tests](./testing-guide.md#integration-tests)
- [Architecture Overview](./architecture-overview.md)
- Issue #1225 — root issue
