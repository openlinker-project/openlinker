# Implementation Plan — #525 Auto-Invoke PrestaShop Post-Install Scripts

## 1. Understand the task

**Goal.** Eliminate the manual `pnpm dev:stack:seed-prestashop` step from the onboarding flow. After this lands, a fresh `docker volume rm openlinker_prestashop_data && docker compose up prestashop` produces a fully-seeded shop (`/admin-dev/` URL, PLN default, 5 `OL-*` fixtures) with **zero** operator action between `up` and a working dev environment.

**Layer.** DX / dev-stack only. **No** changes to:
- Backend code (`apps/api`, `libs/`, `apps/worker`)
- Frontend code (`apps/web`)
- DB migrations
- The PrestaShop module (`apps/prestashop-module/openlinker/`)
- The post-install scripts themselves (`docker/prestashop/post-install/`)

**Non-goals (carried from #525 issue body):**
- Changing the script naming convention or the `/tmp/post-install-scripts:ro` mount path.
- Polling cadence tuning beyond a sensible default.
- Logging / observability for script failures (operators see them via `docker compose logs prestashop`).

**Success criterion.** First-time contributor doing `git clone && docker compose up` lands at a logged-in `/admin-dev/` with PLN currency and the 5 fixtures present.

## 2. Research the codebase + container

**What exists today**

- `docker-compose.yml:73-110` — the `prestashop` service. Default upstream entrypoint is `/usr/local/bin/docker-php-entrypoint` which is a 7-line shim that effectively `exec`s `apache2-foreground` (verified by reading the script inside the container). PID 1 is `apache2 -DFOREGROUND`.
- `docker-compose.yml:104` — already mounts `./docker/prestashop/post-install:/tmp/post-install-scripts:ro`.
- `docker/prestashop/post-install/` — `10-rename-admin.sh`, `20-set-default-currency.sh` (+ `.php`), `30-seed-test-products.sh` (+ `.php`). All three idempotent.
- `package.json` — `pnpm dev:stack:seed-prestashop` runs `for f in /tmp/post-install-scripts/*.sh; do ... sh "$f" || exit $?; done` inside the container. Stays in place as the "force-reseed" affordance after this PR.
- `docs/getting-started.md` — currently instructs operators to run `pnpm dev:stack:seed-prestashop` between `dev:stack:up` and "log in".

**Install-complete marker (verified live)**

PrestaShop's own auto-installer **removes the `install/` directory after install completes** (canonical PS security best-practice — leaving the install dir reachable on a deployed shop is a known footgun, so the installer self-deletes it). Verified on the running dev container:
- `ls /var/www/html/install*` → not found (install completed)
- `/var/www/html/.env` exists (populated by installer)
- `/var/www/html/app/config/` populated with shop config

So the polling check is `while [ -d /var/www/html/install ]; do sleep 5; done`. Cleaner than `parameters.php` (which doesn't exist in PS 9.x's bind-mount layout) or `.env` (which exists *during* install too).

**Entrypoint composition strategy**

The upstream image's `ENTRYPOINT` is `/usr/local/bin/docker-php-entrypoint`. We override it with a wrapper that:
1. Backgrounds a subshell that polls for `install/` removal, then sequentially runs `*.sh` from `/tmp/post-install-scripts/`.
2. `exec`s the upstream entrypoint with `apache2-foreground` so Apache becomes PID 1, matching upstream behaviour. PHP request handling (which is what triggers the auto-installer on first boot) starts immediately.

Net effect: container starts → wrapper backgrounds the polling subshell → apache takes over PID 1 → PS auto-installer runs (because no DB tables yet on first boot) → installer removes `install/` → polling subshell wakes, runs `10-` → `20-` → `30-`. Idempotency guards in each script make warm-boot a no-op.

## 3. Design the solution

### `docker/prestashop/entrypoint-wrapper.sh` (new, executable)

```sh
#!/bin/sh
# PrestaShop dev container entrypoint wrapper (#525).
#
# Auto-runs every *.sh in /tmp/post-install-scripts/ once the upstream
# auto-installer finishes — eliminating the manual `pnpm dev:stack:seed-prestashop`
# step that #156 + #521 each had to work around.
#
# Install-complete marker: absence of /var/www/html/install/. PrestaShop's
# installer removes that directory at the end of the install sequence
# (canonical PS security best-practice; leaving the install dir reachable
# on a deployed shop is a known footgun, so the installer self-deletes).
# More reliable than `parameters.php` (PS 9.x doesn't ship that file at the
# legacy path) or `.env` (the installer creates it *during* install, not at
# the end).
#
# Pattern: background-poll + exec upstream CMD. Same shape WordPress, Drupal,
# and Bitnami PrestaShop's official Docker images use — keeps Apache as PID 1
# so signal handling (`docker compose stop`) routes upstream natively.
# See https://github.com/docker-library/wordpress/blob/master/latest/apache/docker-entrypoint.sh
# for the canonical reference implementation.
#
# Bounded polling: aborts with a loud error after MAX_WAIT_SECONDS (default
# 300s ≈ install takes 2-3min in practice, 5x headroom). Prevents stuck
# containers when upstream install genuinely fails.
#
# This wrapper does NOT replace `pnpm dev:stack:seed-prestashop`: that
# command stays as the force-reseed affordance for operators who want to
# re-run the scripts mid-development without restarting the container.
#
# Cosmetic note: the background subshell exits cleanly after running the
# scripts and shows up as `<defunct>` in `ps` until the container is
# restarted. No resource leak; not worth pulling in `tini` for a dev
# container. (Postgres / WordPress / MySQL official images skip `tini`
# for the same reason.)
set -e

MAX_WAIT_SECONDS=${PS_POST_INSTALL_MAX_WAIT_SECONDS:-300}
SCRIPT_DIR=/tmp/post-install-scripts

# Background subshell: poll for install completion, then run the scripts.
# Runs as a child of PID 1 (apache).
(
  # Phase 1: wait for the upstream image to populate the volume + trigger
  # the installer (install/ appears, OR .env appears in the warm-boot case
  # where the volume is already initialised). Bounded by 60s — generous for
  # a fresh-volume copy; on warm boot, .env is already there and the loop
  # falls through immediately. Without this phase, a fresh-volume cold start
  # races: the wrapper sees an empty /var/www/html/, concludes (incorrectly)
  # that the install is complete, and runs the post-install scripts against
  # an unbootstrapped shop.
  echo '* [ps-post-install] waiting for PS image to populate the volume...'
  waited=0
  while [ ! -d /var/www/html/install ] && [ ! -f /var/www/html/.env ]; do
    if [ "$waited" -ge 60 ]; then
      echo '* [ps-post-install] phase 1 timed out at 60s — proceeding to phase 2 anyway' >&2
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done

  # Phase 2: wait for the installer to finish (install/ removed). Bounded
  # by MAX_WAIT_SECONDS to prevent stuck containers when upstream install
  # genuinely fails.
  echo '* [ps-post-install] waiting for PS auto-install to complete...'
  waited=0
  while [ -d /var/www/html/install ]; do
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      echo "* [ps-post-install] FATAL: install/ still present after ${MAX_WAIT_SECONDS}s — aborting (post-install scripts will NOT run; check upstream install logs)" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "* [ps-post-install] install complete (waited ${waited}s)"

  # Brief settle: PS removes install/ before the Symfony cache layer is
  # fully warm. 5s is enough for the warmup to converge in practice;
  # avoids a class of "Cache::clean() during warmup" errors when the
  # post-install scripts call ObjectModel APIs immediately after.
  sleep 5

  echo '* [ps-post-install] running post-install scripts...'
  for f in "$SCRIPT_DIR"/*.sh; do
    [ -f "$f" ] || continue
    echo "* [ps-post-install] --- $(basename "$f") ---"
    if ! sh "$f"; then
      echo "* [ps-post-install] $(basename "$f") exited non-zero — aborting chain" >&2
      exit 1
    fi
  done
  echo '* [ps-post-install] post-install scripts complete.'
) &

# Hand off to apache as PID 1 (matches upstream behaviour: docker-php-entrypoint
# is a 7-line shim whose only purpose is rewriting `-XYZ`-style args into
# `apache2-foreground -XYZ` — we're calling apache directly, so the shim is
# a no-op we can skip).
exec apache2-foreground
```

### `docker-compose.yml` edit

Two changes to the `prestashop` service:
1. Add `entrypoint: /usr/local/bin/entrypoint-wrapper.sh` (new line below `image:`).
2. Mount the wrapper at the `/usr/local/bin/` path so it overrides the upstream resolution. Add to the `volumes:` block:
   ```yaml
   - ./docker/prestashop/entrypoint-wrapper.sh:/usr/local/bin/entrypoint-wrapper.sh:ro
   ```

### `docs/getting-started.md` edit

Replace the current "run `pnpm dev:stack:seed-prestashop` once the install completes" step with:

> The first `docker compose up` automatically renames the admin folder, sets PLN as the default currency, and seeds 5 fixtures sourced from real Allegro listings — the entrypoint wrapper polls for install completion and runs every script in `docker/prestashop/post-install/` in order.
>
> To force a re-seed (e.g. after manually breaking PS data during development), run:
> ```bash
> pnpm dev:stack:seed-prestashop
> ```
> Idempotent — re-running is a no-op when fixtures are already present.

Plus a one-line note in the existing fixture-reference section: "Auto-runs on first `docker compose up` per [#525](https://github.com/openlinker-project/openlinker/issues/525)."

### Operator action required for existing dev installs

The compose change adds an `entrypoint:` directive — operators need to **`docker compose down && docker compose up -d`** to pick it up (Compose doesn't restart containers on entrypoint change unless the container is recreated). Document this in the PR description and as a one-line note in the doc step.

### Branch / files

```
docker/prestashop/entrypoint-wrapper.sh                  (new — executable)
docker-compose.yml                                       (edit — entrypoint + 1 volume mount)
docs/getting-started.md                                  (edit — remove manual step, add note)
```

## 4. Step-by-step implementation plan

1. **Write `docker/prestashop/entrypoint-wrapper.sh`** per §3. `chmod +x`.
2. **Edit `docker-compose.yml`** — add `entrypoint:` line + the wrapper volume mount under `prestashop:`.
3. **Edit `docs/getting-started.md`** — replace the manual-seed step with the auto-invocation copy + retain the `pnpm dev:stack:seed-prestashop` as the force-reseed escape hatch.
4. **Smoke verification (manual, documented in PR description):**
   - **Migration step for existing dev stacks**: `docker compose down && docker compose up -d prestashop` (Compose's `restart` doesn't recreate containers on entrypoint change; a full `down/up` is required to pick up the new `entrypoint:` directive).
   - **Cold start (fresh volume)**: `docker compose down && docker volume rm openlinker_prestashop_data && docker compose up -d prestashop` — wait for install (~2–3 min)
   - `docker compose logs prestashop | grep ps-post-install` — should show phase 1 → phase 2 → settle → script invocations in order
   - Open `http://localhost:8080/admin-dev/` — login should succeed without operator running any pnpm command
   - PS admin → Localisation → Currencies — PLN is default
   - PS admin → Catalog → Products — exactly the 5 OL-* fixtures
   - **Warm-boot idempotency**: `docker compose restart prestashop` — wrapper re-runs but every script early-exits via its idempotency guard. Phase 1 falls through immediately (`.env` exists). No errors, no duplicate fixtures.
   - **Timeout path**: set `PS_POST_INSTALL_MAX_WAIT_SECONDS=10` via `environment:` and recreate against a fresh volume — confirm wrapper aborts with the loud FATAL log and Apache stays running (subshell exit doesn't kill PID 1).
   - **Concurrent force-reseed**: while the entrypoint subshell is mid-chain, run `pnpm dev:stack:seed-prestashop` against the same container — confirm no race, no duplicate writes (each script's idempotency guard prevents double effects). Both invocations can complete cleanly.

## 5. Validate against architecture & standards

- ✅ **Layer**: DX only. No CORE / Integration / Interface / Frontend / migration code touched. No port-contract changes.
- ✅ **Naming**: `entrypoint-wrapper.sh` matches the descriptive-kebab convention used by `10-rename-admin.sh` etc.
- ✅ **Idempotency**: every existing post-install script self-guards. The wrapper itself is implicitly idempotent — its only side effect is running the scripts, which themselves are idempotent.
- ✅ **No secrets**: wrapper inherits credentials from the existing dev env. No new env-var dependencies.
- ✅ **Docs updated**: `getting-started.md` reflects the new flow; force-reseed escape hatch documented.

## Risks & open questions

1. **`install/` removal isn't atomic with the install completing.** PS removes the dir as one of the last steps but other state may not be ready yet (e.g. cache warmup). If a script runs and the DB isn't fully ready, the script fails its own checks. Mitigation: each script's existing PS bootstrap (`config.inc.php`) fails loudly if the DB connection isn't up, and the wrapper aborts the chain on first failure — operator sees the error in logs and retries via `docker compose restart`. Low-likelihood, well-bounded.
2. **PS image bumps in the future may rename the install directory.** Probability: very low — `install/` has been the canonical name across PS 1.x, 8.x, and 9.x. Mitigation: if it ever moves, the wrapper's polling check is one line to update, and the symptom (scripts never run) is loud.
3. **Defunct subshell after script chain completes.** Apache as PID 1 doesn't reap children. The polling subshell exits cleanly after the scripts finish, leaving a `<defunct>` entry in `ps` until container restart. Cosmetic only — no resource leak. Worth noting in the script header but not worth solving with `tini` for a dev shop.
4. **Operators with running dev stacks need a one-time `docker compose down`/`up`** to pick up the new entrypoint. Documented in the PR body. Compose's behaviour here is by design (entrypoint is baked into the container at create time, not on `restart`).
