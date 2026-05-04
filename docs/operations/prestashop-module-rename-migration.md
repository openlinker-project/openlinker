# PrestaShop Module Rename Migration (#519)

One-time operator runbook for shops with a pre-#514 install of the bind-mount module. PR for #514 renamed `openlinkerwebhooks → openlinker`; the `module=` slug in the cron URL changed correspondingly. If your shop wasn't migrated when #514 shipped, the cron silently 404s and webhook events stop being delivered until the migration is applied.

## Symptom check

Run from the host that runs the PS container:

```bash
# 1. Is the old module still registered as active?
docker compose exec prestashop sh -c \
  'mysql -h mysql -u prestashop -pprestashop prestashop -e \
   "SELECT id_module, name, active FROM ps_module WHERE name LIKE \"openlinker%\";"'
```

| Output | Diagnosis |
|---|---|
| Empty / no rows | Module never installed — no migration needed; install fresh per `docs/getting-started.md`. |
| `name='openlinker', active=1` | Already migrated. Verify cron URL uses `module=openlinker` and you're done. |
| `name='openlinkerwebhooks', active=1` | **Migration needed.** Continue below. |

```bash
# 2. Are the module files where the new bind-mount points?
docker compose exec prestashop ls -la /var/www/html/modules/openlinker/openlinker.php
```

If the file doesn't exist, the bind-mount hasn't been applied. The compose recreate in step 3.2 below will fix this.

```bash
# 3. How many events are pending?
docker compose exec prestashop sh -c \
  'mysql -h mysql -u prestashop -pprestashop prestashop -e \
   "SELECT status, COUNT(*) FROM ps_openlinker_webhook_outbox GROUP BY status;" 2>/dev/null'
```

A non-zero `pending` count is informational only — both migration paths below preserve the outbox table and any rows in it (see "Backlog handling" below).

## Backlog handling

The `uninstall()` hook in `openlinker.php` **preserves** `ps_openlinker_webhook_outbox` and `ps_openlinker_cart_shipping` — both `dropOutboxTable()` and `dropCartShippingTable()` calls are commented out by design (see `openlinker.php:171,177`, "kept commented to match the conservative outbox default"). The install hook re-creates each table with `CREATE TABLE IF NOT EXISTS`, so existing rows survive uninstall + reinstall.

Practical implication: any pending events queued during the broken-cron window stay in place. After step 5 finishes, the new cron URL resumes delivering them on the next tick — no manual drain needed.

If you'd rather start fresh and discard the backlog (e.g., the events are stale and you want a clean slate), run this opt-in cleanup at any point during the migration:

```bash
docker compose exec prestashop sh -c \
  'mysql -h mysql -u prestashop -pprestashop prestashop -e \
   "DROP TABLE IF EXISTS ps_openlinker_webhook_outbox; DROP TABLE IF EXISTS ps_openlinker_cart_shipping;"'
```

## Migration steps

### 1. Uninstall the old module

**Path A — module loadable** (`/var/www/html/modules/openlinkerwebhooks/openlinkerwebhooks.php` exists on disk):

PS admin → **Modules → Module Manager → openlinkerwebhooks → Uninstall**. The uninstall hook removes hooks, deletes the admin tab, soft-deletes the OL Dynamic carrier, and clears `OPENLINKER_*` configuration keys. It does **not** drop the outbox or cart_shipping tables — they survive the uninstall (and the reinstall, since `CREATE TABLE IF NOT EXISTS` is a no-op when the tables already exist).

**Path B — module stale** (directory exists but is empty post-#514; common case if you skipped this migration when #514 shipped):

The GUI uninstall fails because PS can't autoload the missing PHP class. Use the SQL fallback:

```bash
docker compose exec prestashop sh -c '
mysql -h mysql -u prestashop -pprestashop prestashop <<SQL
SET @id_module := (SELECT id_module FROM ps_module WHERE name = "openlinkerwebhooks");
DELETE FROM ps_hook_module WHERE id_module = @id_module;
DELETE FROM ps_module_shop WHERE id_module = @id_module;
DELETE FROM ps_module WHERE id_module = @id_module;

-- Authorization roles are keyed by slug, not module-id FK. Two slug families
-- per module: ROLE_MOD_MODULE_<UPPER>_<CRUD> and ROLE_MOD_TAB_<UPPER>_<CRUD>.
DELETE FROM ps_module_access
  WHERE id_authorization_role IN (
    SELECT id_authorization_role FROM ps_authorization_role
    WHERE slug LIKE "ROLE_MOD_MODULE_OPENLINKERWEBHOOKS_%"
       OR slug LIKE "ROLE_MOD_TAB_ADMINOPENLINKERWEBHOOKS_%"
  );
DELETE FROM ps_authorization_role
  WHERE slug LIKE "ROLE_MOD_MODULE_OPENLINKERWEBHOOKS_%"
     OR slug LIKE "ROLE_MOD_TAB_ADMINOPENLINKERWEBHOOKS_%";

-- Admin tab created by the module install hook
DELETE FROM ps_tab_lang WHERE id_tab IN (SELECT id_tab FROM ps_tab WHERE module = "openlinkerwebhooks");
DELETE FROM ps_tab WHERE module = "openlinkerwebhooks";

-- Outbox + cart_shipping tables are intentionally NOT dropped here. The
-- install hook in step 3 uses CREATE TABLE IF NOT EXISTS, so existing
-- rows survive into the new module. See "Backlog handling" above for the
-- opt-in cleanup snippet if you want a clean slate.
SELECT "Uninstall complete" AS status;
SQL
'
```

This recipe leaves `ps_configuration` rows intact on disk, but the install hook in step 3 calls `setDefaultConfiguration()` and **resets all four `OPENLINKER_*` keys** regardless: `OPENLINKER_BASE_URL` / `..._CONNECTION_ID` / `..._WEBHOOK_SECRET` are reset to empty strings, and `OPENLINKER_CRON_TOKEN` is regenerated. Plan to re-enter every config value in step 4.

### 2. Recreate the container to apply the new bind-mount

```bash
docker compose down
docker compose up -d prestashop
```

`docker compose restart` is **not** sufficient — Compose only refreshes volume mounts on container creation, not restart (same constraint #525's entrypoint change documented). Verify the new path is live:

```bash
docker compose exec prestashop ls -la /var/www/html/modules/openlinker/openlinker.php
# expect: -rw-r--r-- ... openlinker.php
```

### 3. Install the new module

**Recommended: PS admin GUI** → **Modules → Module Manager → search "openlinker" → Install**. The legacy install hook fires reliably via this path and:

- Ensures `ps_openlinker_webhook_outbox` exists (`CREATE TABLE IF NOT EXISTS` — preserves any pre-existing rows).
- Ensures `ps_openlinker_cart_shipping` exists (same idempotent create).
- Seeds the OL Dynamic carrier (per #515) — visible as `OpenLinker Dynamic` in the carrier-mapping picker; persists `OPENLINKER_DYNAMIC_CARRIER_ID` to `ps_configuration`.
- Registers the standard hook set (`actionProductSave`, `actionValidateOrderAfter`, `actionOrderHistoryAddAfter`, `actionUpdateQuantity`, `actionCarrierUpdate`).
- Calls `setDefaultConfiguration()`, which resets `OPENLINKER_BASE_URL` / `..._CONNECTION_ID` / `..._WEBHOOK_SECRET` to empty strings and generates a fresh `OPENLINKER_CRON_TOKEN` (64-char hex).

**CLI alternative (for automation only):**
```bash
docker compose exec prestashop sh -c 'cd /var/www/html && php bin/console prestashop:module install openlinker'
# verify tables were created — if SHOW TABLES LIKE "%openlinker%" returns nothing,
# `bin/console install` registered the module but skipped the legacy install hook.
# Workaround: uninstall + reinstall to force the hook:
docker compose exec prestashop sh -c 'cd /var/www/html && php bin/console prestashop:module uninstall openlinker && php bin/console prestashop:module install openlinker'
```
The reinstall cycle is needed because PS 9.x's Symfony module-installer occasionally bypasses the legacy `install()` method's table-creation step on the first invocation (verified on `prestashop:9.0.2-2.0-classic-8.4`). The GUI path doesn't have this gotcha.

### 4. Re-enter operator config keys

Open the module's Configure page (Module Manager → openlinker → Configure) and set:

- `OPENLINKER_BASE_URL` — your OpenLinker API base, e.g. `http://host.docker.internal:3000`
- `OPENLINKER_CONNECTION_ID` — the PrestaShop connection's UUID from the OpenLinker app
- `OPENLINKER_WEBHOOK_SECRET` — the HMAC shared secret (must match `OL_WEBHOOK_SECRET` on the OpenLinker side)

⚠️ **All four `OPENLINKER_*` configuration keys are reset by every install path.** The GUI install, `bin/console install`, and the SQL recipe → install sequence all run `setDefaultConfiguration()` (`openlinker.php:124`), which unconditionally calls `Configuration::updateValue()` for `OPENLINKER_BASE_URL`, `OPENLINKER_CONNECTION_ID`, `OPENLINKER_WEBHOOK_SECRET` (all reset to `''`) and `OPENLINKER_CRON_TOKEN` (regenerated to a fresh 64-char hex). The path B SQL recipe leaves the underlying `ps_configuration` rows intact, but the install hook overwrites them anyway. Practical implication: **always copy the new token from the Configure page after install and update host crontabs in step 5** — there's no operator path that preserves the original token across uninstall/install.

### 5. Update host crontab(s)

Replace `module=openlinkerwebhooks` with `module=openlinker` in every crontab entry. The rest of the URL is unchanged:

```diff
- 0 * * * * curl -s "https://shop.example.com/index.php?fc=module&module=openlinkerwebhooks&controller=cron&token=$TOKEN"
+ 0 * * * * curl -s "https://shop.example.com/index.php?fc=module&module=openlinker&controller=cron&token=$TOKEN"
```

Same `controller=cron`, same `token=...`. HMAC behaviour is unchanged.

### 6. Optional — clean up the stale directory

The empty `openlinkerwebhooks/` directory still lives in the volume after path B. Functionally inert but cosmetic clutter:

```bash
docker compose exec prestashop rm -rf /var/www/html/modules/openlinkerwebhooks
```

## Verification

```bash
# 1. ps_module shows openlinker active, no openlinkerwebhooks row
docker compose exec prestashop sh -c \
  'mysql -h mysql -u prestashop -pprestashop prestashop -e \
   "SELECT id_module, name, active FROM ps_module WHERE name LIKE \"openlinker%\";"'
# expect: one row, name='openlinker', active=1
```

```bash
# 2. Cron URL responds with delivery JSON (substitute YOUR_CRON_TOKEN)
curl -s "http://localhost:8080/index.php?fc=module&module=openlinker&controller=cron&token=YOUR_CRON_TOKEN"
# expect: {"ok":true,"delivered":N,...}  with 200 status, N=0 if outbox is empty
```

```bash
# 3. After the next cron tick (or a manual cron call above), Last Delivery is non-NULL
docker compose exec prestashop sh -c \
  'mysql -h mysql -u prestashop -pprestashop prestashop -e \
   "SELECT MAX(delivered_at) AS last_delivery FROM ps_openlinker_webhook_outbox;"'
```

If your shop had a backlog before migration and you drained it (or accepted the loss), `Pending Events` should now sit at its steady-state baseline (≈0 under normal load). The Configure page's Statistics panel surfaces this in real time.

## Rollback

If the migration goes wrong, the dev-phase contract (no back-compat shims, per #514) means there's no two-version-coexist mode. Recovery is straightforward in dev because there's nothing to lose:

```bash
docker compose down
docker volume rm openlinker_prestashop_data
docker compose up -d prestashop
# wait ~2-3 min for auto-install + post-install hooks (per #525)
```

This wipes the PS DB and reinstalls the upstream image from scratch, then the entrypoint wrapper from #525 runs the post-install scripts (rename admin → set PLN currency → seed fixtures from #521). You'll re-create the OpenLinker connection in the OL app.

For production / customer installs, take a MySQL backup before step 1.
