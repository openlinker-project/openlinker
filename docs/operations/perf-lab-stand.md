# Performance measurement stand (`lab`)

Operational runbook for the isolated stand the performance measurement programme
(epic #2840) runs on.

**This page currently covers the bootstrap step only.** Standing the stack up,
tearing it down, the Postgres tuning and the preflight are #2854's, and land in
this file beside this section.

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
