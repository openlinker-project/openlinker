# Performance measurement stand (`lab`)

Operational runbook for the isolated stand the performance measurement programme
(epic #2840) runs on.

**This page covers stand-up and the bootstrap step.** A `preflight.sh`
wrapper, `pg_stat_statements`/`auto_explain` (a second overlay, for #2843
only), the `allegro-stub`/`prestashop-stub` services and a Prometheus/Grafana
scrape config are not built yet - see #2854 for that remaining scope.

## Standing the stack up

`docker-compose.lab.yml` (repo root) is a **self-contained** compose file, not
an overlay on `docker-compose.yml`/`docker-compose.demo.yml` - project name
`lab`, container names `lab-*`, ports shifted into the 19xxx range so it runs
alongside both the `openlinker` (dev) and `ol-demo-fresh` (demo) stacks with no
collision. It reuses the already-built `ol-perf:api` / `ol-perf:worker` images
(built with `--build-arg OL_GIT_SHA=$(git rev-parse HEAD)`, which
`guard_build` checks) rather than rebuilding - rebuild those two images
yourself before standing this up against a different commit.

```bash
cp .env.lab.example .env.lab   # then fill in the REPLACE_ME secrets, or:
#   OPENLINKER_CREDENTIALS_ENCRYPTION_KEY: openssl rand -base64 32
#   JWT_SECRET / OL_PII_HASH_SALT:         openssl rand -hex 32

# one-time: self-signed cert for the wc-tls proxy (see its own header comment)
bash perf/openlinker-throughput/stand/wc-tls/generate-certs.sh

docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab up -d
```

`--env-file .env.lab` REPLACES compose's default `.env` lookup - it does not
merge with the repo root `.env` the other two stacks use, so this stand
cannot leak into or collide with them, and vice versa.

### WooCommerce needs an https origin, and that needs two things done in order

WooCommerce's REST API refuses Basic Auth unless `is_ssl()` is true (over
cleartext it accepts only OAuth 1.0a), and OpenLinker's own WooCommerce
connection config DTO independently rejects a non-https `siteUrl`. The `wc-tls`
service is a plain `nginx:1.27-alpine` terminating a self-signed cert
(`perf/openlinker-throughput/stand/wc-tls/generate-certs.sh` generates it on
the **host**, so nothing here needs a `docker build`) in front of the
plain-HTTP `woocommerce` container, and `api`/`worker` trust that one CA via
`NODE_EXTRA_CA_CERTS` rather than disabling TLS validation stack-wide.

That gets the TLS handshake to succeed, but WordPress core's `is_ssl()` never
looks at `X-Forwarded-Proto` on its own, so WooCommerce still sees a plain-HTTP
request and still refuses Basic Auth. **A one-time manual step closes that
gap**, run once per fresh `woocommerce` volume:

```bash
docker exec lab-woocommerce mkdir -p /opt/bitnami/wordpress/wp-content/mu-plugins
docker cp perf/openlinker-throughput/stand/wc-mu-plugins/force-https.php \
  lab-woocommerce:/opt/bitnami/wordpress/wp-content/mu-plugins/force-https.php
```

This is a `docker cp` **after** the container reports healthy, not a
bind-mount in the compose file - bind-mounting a file under
`/bitnami/wordpress/wp-content/` before the Bitnami entrypoint's first boot
was tried first and made that entrypoint take its "restore an existing
install" branch against an empty volume, which fails with `wp-config.php not
found` (verified live). Whatever ships this permanently (baking the mu-plugin
into a tiny custom WooCommerce image, or a `docker-entrypoint-initdb.d` script
that copies it in after `wp core is-installed`) is left for whoever picks up
the remaining #2854 scope.

### Seeding a fresh catalogue

A brand-new PrestaShop fixture install carries **no `ps_tax_rules_group` row
at all** under `PS_COUNTRY=US` (the default both `docker-compose.yml` and this
file use), and `bootstrap.sh`'s tax-group step can only repair "some products
have no group" - it has nothing to repair to when *no* product has one
either. Assign one manually before running `bootstrap.sh`:

```sql
INSERT INTO ps_tax_rules_group (name, active, deleted, date_add, date_upd)
  VALUES ('Lab standard rate', 1, 0, NOW(), NOW());
UPDATE ps_product SET id_tax_rules_group = LAST_INSERT_ID();
```

And `bootstrap.sh`'s Allegro offer-mapping step needs at least one non-stale
`product_variants` row to point mappings at, which only exists once
OpenLinker has actually synced the PrestaShop catalogue - nothing does that on
a schedule with `OL_SCHEDULER_ENABLED=false` / `WORKER_RUNNER_ENABLED=false`
(this stand's own F3 posture). Run one sync manually first: recreate `worker`
with `WORKER_RUNNER_ENABLED=true` (`docker compose ... up -d --force-recreate
worker` with that var overridden in the shell, which takes precedence over
`.env.lab`), enqueue `master.product.syncAll` against the PrestaShop
connection via `POST /v1/sync/jobs`, wait for it to drain, then recreate
`worker` again with the runner back off.

### Running migrations without a rebuild

`migrate` reuses `ol-perf:api` rather than a second `target: base` build -
unnecessary once verified live: the production image's compiled
`apps/api/dist/apps/api/src/database/data-source.js` needs no `ts-node`
registration, and its entity/migration globs already resolve against the
compiled `libs/*/dist` tree shipped in the same image. It is invoked as `sh
node_modules/.bin/typeorm migration:run -d
apps/api/dist/apps/api/src/database/data-source.js` - **`sh`, not `bash`**:
the `.bin/typeorm` shim is a POSIX `#!/bin/sh` script and this alpine-based
image has no `bash` at all (both facts verified live; `apps/api/package.json`'s
own `migration:run` script invokes it via `bash` on a dev machine that has
one).

---

## What the bootstrap does, and why it has to exist

`perf/openlinker-throughput/bootstrap.sh` takes a freshly reset stand to a state
where every perf scenario can run, with no browser step and no manual paste.

It exists because two claims the programme makes cannot both be true while any
of this is manual: *"a wipeable stand whose database is zeroed before each run"*
and *"`run-all` executes the full campaign unattended and resumably"*. An
eight-hour unattended campaign cannot contain a back-office walkthrough.

Four of the things it sets up are correctness preconditions rather than
conveniences. Without them the stand looks healthy and every measured order
fails, in most cases silently:

| Precondition | What happens without it |
|---|---|
| OL PrestaShop module installed **via `install()`** | `discoverDynamicCarrierId` runs first and unconditionally on every order create and throws `PrestashopOlCarrierMissingException`. The carrier row is created inside the module's `install()` hook, so a `ps_module` row alone is not enough |
| `Offer` identifier mappings for each Allegro tenant | every stub order fails item resolution, persists as `awaiting_mapping`, never reaches a destination create, and burns ten retry attempts over roughly 30 hours |
| A tax rules group on every seeded product | the PrestaShop adapter converts gross to net on every order whose tax treatment is not `exclusive`, then resolves the destination product's own rate and throws the non-retryable `PrestashopTaxRateUnknownException`. This is unrelated to `OL_TAX_RATE_STRICT_ENABLED`, which is an issuance-side switch |
| WebService key bound to every active shop | PS 9.x answers 503 "The PrestaShop webservice is disabled" with `PSWS-Version: 0` for an account with no `ps_webservice_account_shop` row, even with `PS_WEBSERVICE` on |

A destination-create failure does **not** fail the job: the fan-out is a
`Promise.allSettled` whose per-destination rejection is recorded as a message on
`order_records.syncStatus` without rethrowing, so the job reports `outcome: 'ok'`
and the queue drains. That is why these are checked here rather than discovered
from a green run that measured nothing.

## Running it

```bash
cd perf/openlinker-throughput

# probe and report, write nothing; exits 1 if anything is missing
./bootstrap.sh --verify-only

# print what it would do, touch nothing
./bootstrap.sh --dry-run

# bootstrap, writing stand-ids.env
./bootstrap.sh
```

It is idempotent. A second run against an already-bootstrapped stand reports
`created: 0` and re-emits identical ids.

### Pointing it at a stand

Every container name and URL is an environment variable, defaulting to the `lab`
stand. Against another stack, override them:

```bash
PS_CONTAINER=ol-demo-fresh-prestashop \
PS_MYSQL_CONTAINER=ol-demo-fresh-mysql \
WC_CONTAINER=ol-demo-fresh-woocommerce \
PG_CONTAINER=ol-demo-fresh-postgres \
OL_API_URL=http://127.0.0.1:13000 \
OL_ADMIN_PASSWORD=... \
./bootstrap.sh --verify-only
```

`ALLEGRO_OFFER_POOL_SIZE` (default 200) is how many distinct offer ids each
Allegro tenant gets a mapping for. **It must match the stub's own offer-id space**
(#2856), and it is also the product-pool size #2847 records for the PrestaShop
tax-cache decay term.

## What it writes

`stand-ids.env`, sourced by the harness. It is generated, git-ignored, and must
not be edited by hand:

```
PS_CONNECTION_ID / WC_CONNECTION_ID / ALLEGRO_A_CONNECTION_ID / ALLEGRO_B_CONNECTION_ID
PS_WEBSERVICE_KEY
WC_CONSUMER_KEY / WC_CONSUMER_SECRET
PS_TAX_RULES_GROUP
ALLEGRO_OFFER_POOL_SIZE
```

`stand-bootstrap-undo.txt` records every item the run created, in order, so a
verification run against a shared stack can be reversed.

`PS_TAX_RULES_GROUP` is recorded because `perf/prestashop-baseline/seed-products.sh`
clones a template product row wholesale, so the seeded catalogue's tax rules
group is whatever `TEMPLATE_ID` happened to carry. A campaign that cannot name
that value cannot explain a `PrestashopTaxRateUnknownException` later.

**The tax-group step repairs, it does not only diagnose.** If any seeded
products carry no `id_tax_rules_group`, the step sets it to the dominant group
already present on the rest of the catalogue (the same value it resolves into
`PS_TAX_RULES_GROUP`). If *no* product in the catalogue carries a tax rules
group at all, there is nothing to repair to, and the step reports a gap
instead — assign one manually in the shop's back office. `--verify-only` never
writes; it reports the same gap without repairing.

## Things worth knowing before the first run

**The WooCommerce consumer key cannot be read back.** WooCommerce stores it
hashed (`hash_hmac('sha256', $ck, 'wc-api')`), so a re-run that cannot find the
value in `stand-ids.env` rotates the key and says so. Keep `stand-ids.env`.

**`siteUrl` for WooCommerce must be `https`.** That is enforced twice: by the
config DTO (`@IsUrl({ protocols: ['https'] })`) and by WooCommerce itself, which
over cleartext accepts only OAuth 1.0a because query-string and Basic auth both
require `is_ssl()`. This is why the stand fronts WooCommerce with the `wc-tls`
proxy. The SSRF predicate that guards `siteUrl` rejects private **IP literals**
only, so a Docker service hostname such as `wc-tls` passes.

**A connection test answers HTTP 200 even when the connection is dead.** The body
carries `{"success": false, "message": ...}`. The bootstrap reads the field, not
the status. Anything else reports a broken connection as healthy.

**There is no delete route for a connection.** The API offers `PATCH :id/disable`
and nothing else, so a bootstrap run against a shared stack leaves its
connections behind. On the `lab` stand this is irrelevant because the reset is a
full `down -v`; anywhere else, remove them deliberately.

**The Allegro connection test is expected to fail until the stub exists.** The
bootstrap creates both Allegro tenants pointing at `http://allegro-stub:8080`
with credentials carrying `accessToken` only, and warns rather than failing when
the stub does not answer. The credential shape is deliberate: with no
`expiresAt` and no `refreshToken`, `ensureFreshToken` short-circuits, so no
request is ever made to the hardcoded real `allegro.pl` token host.

**`enabledCapabilities` on the Allegro tenants is `OrderSource` only.** Adding
`OfferManager` arms `marketplace.offers.sync`, whose scheduler task declares no
required capability, turning a clean 404 into a retryable
`CapabilityNotEnabledException` that burns ten attempts with backoff.

## After a reset

`down -v` destroys the PrestaShop and WooCommerce volumes as well as Postgres, so
both shops reinstall and every credential above is gone. The order is:

1. `down -v`, then bring the stack back up and wait for both shops to finish
   installing (their healthchecks allow roughly two minutes each).
2. Confirm the `migrate` service exited 0.
3. Seed the catalogue.
4. Run `./bootstrap.sh`.
5. Confirm `stand-ids.env` carries every id, and that `--verify-only` exits 0.

## Related

- **#2860** - this bootstrap.
- **#2854** - the stand itself; the rest of this runbook.
- **#2841** - the harness library, which sources `stand-ids.env`.
- **#2856** - the Allegro stub, whose offer-id space must match
  `ALLEGRO_OFFER_POOL_SIZE`.
- **#2840** - the epic.
