# Implementation Plan — #519 PS Module Cron-Rename Operator Followup

## 1. Understand the task

**Goal.** Close the operator-side gap left by #514 (the `openlinkerwebhooks → openlinker` PS module rename). The cron URL exposed by the module's front controller now requires `module=openlinker` instead of `module=openlinkerwebhooks`, but a PS install registered under the old name keeps that registration in `ps_module` until it's actively uninstalled — so the new URL silently 404s and `ps_openlinker_webhook_outbox` events pile up undelivered.

**Layer.** OPS / DX. Issue body explicitly says "**File(s)**: None in this repo — purely external crontab + runbook updates" — but our investigation found the dev shop has the old registration leftover, so the deliverable shifts a touch:

1. **Repo deliverable** — write a one-shot operator-facing migration runbook covering the uninstall-old / recreate-container / install-new / re-configure-cron sequence. Avoids the next operator (or the next dev-shop reset) hitting the same trap blind.
2. **Dev-shop verification** — apply the runbook against the live dev shop to prove it works end-to-end. Capture the verified output in the PR description.

**Non-goals (carried from #519 issue body):**

- A back-compat shim (`module=openlinkerwebhooks` → `module=openlinker` redirect). #514 explicitly opted out of back-compat per the dev-phase contract.
- Wiring an alert if `Pending Events` exceeds a threshold. Useful but distinct issue if desired.

**Repo-wide sweep (verified):**

- `grep openlinkerwebhooks` → 0 hits across the repo (excluding `node_modules`/`.git`/`.claude`).
- `docs/prestashop-module-testing-guide.md` already uses the new `module=openlinker` cron URL throughout.
- `apps/prestashop-module/openlinker/` is the only module directory.

So #514's repo-side rename was thorough. The remaining work is purely operator-facing.

## 2. Research the dev shop state (live)

Captured in the prior investigation step. Summary:

| Aspect | State |
|---|---|
| `/var/www/html/modules/openlinker/` | does not exist — new bind-mount path hasn't been applied (container needs recreate) |
| `/var/www/html/modules/openlinkerwebhooks/` | empty stale directory (old bind-mount removed by #514) |
| `ps_module` row | `id_module=53, name='openlinkerwebhooks', active=1` — never re-installed |
| `ps_configuration` keys | `OPENLINKER_BASE_URL` / `..._CONNECTION_ID` / `..._WEBHOOK_SECRET` all `NULL`; `OPENLINKER_CRON_TOKEN` set |
| `ps_openlinker_webhook_outbox` | exists, 0 rows |
| `ps_cronjobs` | not installed (no `prestashop/ps_cronjobs` module) → operator uses host crontab if any |

The dev shop is the only "operator install" that exists today (dev phase, no customer installs yet). So this issue's verification scope reduces to a single shop.

## 3. Design the solution

### `docs/operations/prestashop-module-rename-migration.md` (new)

Operator-facing one-shot runbook. Sections:

1. **Symptom check** — single SQL/CLI commands to detect the broken state:
   - `mysql ... -e "SELECT name, active FROM ps_module WHERE name LIKE 'openlinker%'"` — if you see `openlinkerwebhooks` instead of `openlinker`, you have the old registration.
   - `ls /var/www/html/modules/openlinker/` — if missing, the bind-mount didn't apply.

2. **Drain the backlog FIRST** (only if `Pending Events` > 0). The `uninstall()` hook in `openlinker.php` **drops** `ps_openlinker_webhook_outbox` and `ps_openlinker_cart_shipping` tables, destroying any pending events. Operators with backlog should hit "Run Delivery Now" on the (still-loadable) old module's Configure page until `Pending Events` reaches 0 — or accept the loss if the events are no longer relevant.

3. **Migration steps**:
   1. **Uninstall the old module.** Two paths:
      - **(A) Module loadable** (`/var/www/html/modules/openlinkerwebhooks/openlinkerwebhooks.php` exists): use PS admin → `Module Manager → Modules → openlinkerwebhooks → Uninstall`. The uninstall hook drops the outbox + cart_shipping tables and removes hooks cleanly.
      - **(B) Module stale** (directory empty post-#514, like the dev shop today): the GUI uninstall fails because PS can't autoload the missing class. Use the SQL fallback recipe:
        ```sql
        SET @id_module := (SELECT id_module FROM ps_module WHERE name = 'openlinkerwebhooks');
        DELETE FROM ps_hook_module WHERE id_module = @id_module;
        DELETE FROM ps_module_shop WHERE id_module = @id_module;
        DELETE FROM ps_module_access WHERE id_module = @id_module;
        DELETE FROM ps_module WHERE id_module = @id_module;
        DROP TABLE IF EXISTS ps_openlinker_webhook_outbox;
        DROP TABLE IF EXISTS ps_openlinker_cart_shipping;
        ```
   2. `docker compose down && docker compose up -d prestashop` — required to pick up the renamed bind-mount path. (Compose's `restart` doesn't refresh volume mounts; same constraint as #525's entrypoint change.) Verify `/var/www/html/modules/openlinker/openlinker.php` exists after up.
   3. Install the new module from PS admin (`Module Manager → Modules → openlinker → Install`). Install hook recreates outbox + cart_shipping tables empty and seeds the OL Dynamic carrier (per #515).
   4. Re-enter operator config keys via the module's Configure page: `OPENLINKER_BASE_URL`, `OPENLINKER_CONNECTION_ID`, `OPENLINKER_WEBHOOK_SECRET`. **Reuse the existing `OPENLINKER_CRON_TOKEN`** (it's preserved across uninstall in the SQL recipe path because we only delete the module rows, not the configuration row); regenerate only if you suspect leakage.
   5. Update any host crontab pointing at the old cron URL — replace `module=openlinkerwebhooks` with `module=openlinker`. Same `controller=cron`, same `token=...`.
   6. **Optional**: `docker compose exec prestashop rm -rf /var/www/html/modules/openlinkerwebhooks` to clean up the empty stale directory.

3. **Verification commands**:
   - `mysql ... -e "SELECT name, active FROM ps_module WHERE name LIKE 'openlinker%'"` — should now show `openlinker, 1`, no `openlinkerwebhooks` row.
   - `curl "http://localhost:8080/index.php?fc=module&module=openlinker&controller=cron&token=$TOKEN"` — should return JSON with `"delivered": N` (N=0 if backlog is empty, which is normal on a fresh dev install).
   - Module Configure page → **Statistics** panel shows `Last Delivery` non-NULL after the next cron tick.

4. **Backlog drain** (only if events accumulated during the broken window) — the configure page's "Run Delivery Now" button processes the pending backlog in batches of `BATCH_SIZE` (default 50). Click repeatedly until `Pending Events` reaches 0.

### `docs/getting-started.md` — one-line cross-reference

Add to the existing PrestaShop section: "If you're upgrading from a pre-#514 install (where the module was named `openlinkerwebhooks`), follow [the rename migration runbook](./operations/prestashop-module-rename-migration.md) once before continuing."

### Branch / files

```
docs/operations/prestashop-module-rename-migration.md     (new)
docs/getting-started.md                                    (edit — one-line cross-reference)
```

No code changes. No tests (operator runbook).

## 4. Step-by-step implementation plan

1. **Verify the install/uninstall SQL hooks** (`apps/prestashop-module/openlinker/sql/install.sql` + `uninstall.sql`) actually preserve the outbox table on uninstall — informs the runbook copy.
2. **Write the runbook** (`docs/operations/prestashop-module-rename-migration.md`) with the symptom check / migration steps / verification commands / backlog drain section.
3. **Update `docs/getting-started.md`** with the one-line cross-reference.
4. **Apply the runbook to the dev shop** to prove it works:
   - Uninstall `openlinkerwebhooks` from PS admin
   - `docker compose down && docker compose up -d prestashop`
   - Install `openlinker`
   - Verify via the runbook's verification commands
   - Capture before/after `mysql` output to paste into the PR description
5. **PR body** documents: (a) repo-wide sweep showed 0 lingering `openlinkerwebhooks` references in code, (b) runbook added + cross-referenced, (c) dev-shop migration verified end-to-end.

## 5. Validate against architecture & standards

- ✅ **Layer**: OPS / DX only. No CORE / Integration / Interface / Frontend / migration code touched. No port-contract changes.
- ✅ **Naming**: runbook lives under `docs/operations/` — new directory but matches the implicit convention (every doc-grouping in `docs/` is a flat folder by topic).
- ✅ **No secrets**: runbook uses `$TOKEN` placeholder; operators substitute their actual `OPENLINKER_CRON_TOKEN` value.
- ✅ **Tests**: not applicable for a doc + verification PR.
- ✅ **Acceptance criteria from the issue body**:
  - "Every known operator crontab pointing at `module=openlinkerwebhooks` has been identified and updated" — repo grep + dev-shop crontab check.
  - "Every operator-facing runbook / wiki snippet referencing the old URL has been updated" — repo grep returned 0 hits.
  - "For each affected shop, `Pending Events` returned to its steady-state baseline" — dev shop verified post-migration.
  - "`Last Delivery` timestamp is within the expected cron interval" — dev shop verified post-migration.

## Risks & open questions

1. **Operator unfamiliarity with PS module install/uninstall**. The runbook walks through the GUI steps; not much we can do beyond clear copy.
2. **Outbox table preservation across uninstall**. The runbook claims `uninstall.sql` preserves the table. Need to verify by reading the SQL before writing the claim — step 1 of the implementation plan.
3. **Operator forgets to restart the container**. The runbook calls this out explicitly (step 2 of migration). Without recreate, install fails because module files aren't on disk.
4. **External customers**. None today (dev phase). If any appear before this issue closes, they need to follow the same runbook.
