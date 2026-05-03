# Implementation Plan — #521 Dev PrestaShop Seed (PLN + Real Allegro Fixtures)

## 1. Understand the task

**Goal.** Replace the upstream PrestaShop demo catalogue (T-shirts, mugs, etc., in EUR) with a deterministic dev fixture set that:

- Defaults the shop currency to **PLN**.
- Ships **5 real-data fixtures** sourced from the Allegro public catalogue, covering the variant × EAN-coverage matrix our codebase actually exercises:

| # | Shape | EAN coverage | Reference (Kod produktu) |
|---|---|---|---|
| 1 | simple, no variants | yes | yes |
| 2 | simple, no variants | empty | yes |
| 3 | variants (3+ combinations) | per-variant EANs on every combination | per-variant references |
| 4 | variants (≥2 combinations) | partial — some have EAN, some don't | per-variant references |
| 5 | variants (≥2 combinations) | empty on every combination | per-variant references |

For each row, name / Kod produktu / EAN / description must be sourced from a real Allegro listing (per user direction) — not synthetic placeholders.

**Layer.** DX / dev-stack only. **No** changes to:
- Backend code (`apps/api`, `libs/`, `apps/worker`)
- Frontend code (`apps/web`)
- DB migrations (`apps/api/src/migrations/`)
- The PrestaShop module (`apps/prestashop-module/openlinker/`)

**Non-goals (carried from #521 issue body):**
- Multi-language seed (lang stays `en`).
- Polish-VAT tax rule seeding.
- Reusable env-driven fixture framework.
- Carriers / customer-groups / payment-modules seed (separate surfaces).
- Backfill for currently-running dev installs — they re-up after `docker volume rm`.

**Out of scope discovered during research (deferred + tracked as separate issue):**
- Auto-running the post-install scripts. Today `10-rename-admin.sh` is mounted into the container at `/tmp/post-install-scripts:ro` but **never auto-invoked** — operators run it manually (or learn from the doc gap and do it). Our new scripts inherit that pattern. **Action:** file a separate dx issue (`[DX] Auto-invoke /tmp/post-install-scripts/* after PrestaShop auto-installer completes`) before this PR ships, link from the PR body. Out of scope for #521 itself.

## 2. Research the codebase + ecosystem

**What exists today**

- `docker-compose.yml:73-104` — the `prestashop` service. `PS_INSTALL_AUTO=1` triggers the auto-installer; demo catalogue + EUR are upstream defaults.
- `docker-compose.yml:104` mounts `./docker/prestashop/post-install:/tmp/post-install-scripts:ro`.
- `docker/prestashop/post-install/10-rename-admin.sh` — the only existing script. Idempotent; documents the convention (`set -e`, "already present, exit 0" guard, descriptive `echo` lines).
- `docs/getting-started.md:30` — declares `/admin-dev/` is the login URL post-rename.
- `apps/prestashop-module/openlinker/` — the renamed module (#514 just shipped, `a82d4ca`).

**Constraints discovered**

- `PrestashopProductMasterAdapter.createProduct` is a documented **stub** (`prestashop-product-master.adapter.ts:270-275`) that throws "use the PS admin interface" — there's no in-house WS create-product helper to reuse.
- Therefore product seeding has to go through one of:
  - **A. Raw SQL** via `mysql` client inside the container — fast, but bypasses framework cascades / validators / multistore-aware writes.
  - **B. PHP + ObjectModel APIs** (`Product::add()`, `Combination::add()`, `StockAvailable::setQuantity()`, `Currency::add()`, `Configuration::updateValue()`) — uses the same code path as the admin UI's "Add product" button; framework owns cascades, FK ordering, lang/shop fan-out.
  - **C. Custom seed module** with PHP install hook — overkill for one-off fixtures; widens scope into the module surface.
  - **D. CSV import via AdminImportController** — fragile for combinations; not code-review-friendly.
  - **E. PS CLI** — `bin/console prestashop:product:add` doesn't exist in 9.x. Currency-add doesn't exist either. Not viable.

**Ecosystem precedent.** `prestashop/sample-data` (the official "demo install" module) ships raw SQL — option A. But it's a frozen blob, not an evolving fixture set. Every reputable third-party fixture / import tool (Store Commander, SC4PrestaShop, the `prestashop-fixtures` community pkg) uses **option B** because the framework owns the cascade order and you don't pay debug time for schema drift across minor PS bumps.

**Decision: PHP + ObjectModel APIs (Pattern B).** Pivoted from the original SQL-first sketch after `/tech-review` flagged this as the industry-standard choice. The ObjectModel layer is stable across PS minor versions and handles the eight-or-so multi-table writes per product correctly without us hand-writing FK ordering.

**Implementation surface.** Standard PS CLI script bootstrap (~5 lines, deliberately legacy):

```php
<?php
// Legacy bootstrap — same path bin/console uses internally for ObjectModel ops.
// We deliberately do NOT boot the Symfony kernel: this script only needs
// Product/Combination/Currency/Configuration/StockAvailable, all of which are
// pre-DI ObjectModel classes. Using the legacy bootstrap keeps the script <100 LoC
// and avoids carrying a DI container + service-id stability assumptions across PS
// minor versions. Future maintainer: do not "modernise" without a reason.
define('_PS_ADMIN_DIR_', __DIR__);
require_once '/var/www/html/config/config.inc.php';
```

Then for each fixture: `$p = new Product(); $p->reference = 'OL-...'; ... $p->add();` and for variants the explicit `Combination::add()` + `addAttributeCombinationMultiple()` pattern (committed, see §3 — not `generateMultipleCombinations`).

**What we'll fetch from Allegro at implementation time**

Per-fixture sourcing approach (concrete URLs picked during implementation via `WebFetch`):

| Row | Allegro category to draw from | Why |
|---|---|---|
| 1 — simple + EAN + ref | electronics or power tools (Bosch / Makita level) | brand-name SKUs reliably ship both EAN13 and producer code |
| 2 — simple, no EAN | handmade / craft / niche service | sellers commonly omit EAN on bespoke items |
| 3 — variant, full EAN | clothing with sizes (S/M/L) from a brand | fashion sellers register a UPC per size |
| 4 — variant, partial EAN | shoes or footwear with mixed registration | half-registered SKU lines are common |
| 5 — variant, no EAN | jewellery or sized industrial parts | bulk/handmade variant lines often skip barcodes |

**Data-handling boundaries**

- Names, EANs, Kod produktu (`ps_product.reference`), category labels: public catalogue facts, fine to encode verbatim.
- Descriptions: paraphrase + trim to ~3-4 plain-text sentences to avoid pasting copyrighted seller copy verbatim into the repo. No HTML, no images, no seller branding.
- No prices from the source listing — deterministic dev-friendly figure (e.g. `99.99`) so price-driven tests stay stable.
- No photos.
- Per-fixture comment in the PHP file points at the **Allegro category** (stable), not a specific listing URL (rotates).

## 3. Design the solution

### Three new files in `docker/prestashop/post-install/`, all idempotent

**`20-set-default-currency.sh`** — thin shell wrapper that execs `php /tmp/post-install-scripts/20-set-default-currency.php`, after a `command -v php` guard.

**`20-set-default-currency.php`** — bootstraps the PS environment, then:
- Resolves PLN via `Currency::getCurrencyInstance(Currency::getIdByIsoCode('PLN'))`. If null, builds a `Currency` object (`iso_code='PLN'`, `numeric_iso_code=985`, `precision=2`, `conversion_rate=4.30`, `active=true`) and calls `->add()` (handles `ps_currency` + `ps_currency_lang` + `ps_currency_shop` automatically).
- Calls `Configuration::updateValue('PS_CURRENCY_DEFAULT', $pln->id)`.
- Early-exits when `Configuration::get('PS_CURRENCY_DEFAULT') === $pln->id`.
- **EUR + USD stay active** (committed decision — they remain pickable, just not default).

**`30-seed-test-products.sh`** — thin shell wrapper that execs `php /tmp/post-install-scripts/30-seed-test-products.php`.

**`30-seed-test-products.php`** — bootstraps PS, then:
- Idempotency guard: `Db::getInstance()->getValue("SELECT COUNT(*) FROM " . _DB_PREFIX_ . "product WHERE reference LIKE 'OL-%'") >= 5` → exit 0.
- Demo-catalogue wipe via the framework, with **operator-preserve convention**: iterate every product, but skip rows whose `reference` starts with `OL-` (our fixtures, never wipe) or `OP-` (operator-preserve — anything a developer hand-adds during testing they want to keep across re-seeds). For everything else: `(new Product($row['id_product']))->delete()` — `Product::delete()` is the canonical method; it cascades through every related table including FKs that lack `ON DELETE CASCADE` at the schema level. Document the `OL-` / `OP-` reference convention in the file header so operators reading it understand how to flag items as keep-safe.
- Per fixture, instantiate `Product`, set fields (`reference`, `ean13`, `name`, `description`, `price`, `id_category_default`, `link_rewrite`, etc.), `->add()`. For variants:
  - `AttributeGroup::add()` (once per group like "Size", "Colour") + `Attribute::add()` per value, only when the group/value isn't already in `ps_attribute_group` / `ps_attribute`.
  - **Explicit `Combination::add()` per variant**, then `$product->addAttributeCombinationMultiple([$id_combination], [[$id_attribute]])` to associate attributes — *not* `Product::generateMultipleCombinations()`. Reason: `generateMultipleCombinations` produces the cartesian product of attribute groups, which is wrong for fixture 4 ("Red has EAN, Blue doesn't") where we need per-combination control over the EAN field. `Combination::add()` is the path the PS admin UI's combinations grid uses for individual entries.
  - `StockAvailable::setQuantity($id_product, $id_combination, $qty)` per variant.
- Wrapped in a single `try/catch`: any exception from an `->add()` call rolls back via explicit `Product::delete()` on partially-seeded rows + re-throw, so a partial seed never leaves dangling state.

### Manual invocation: new pnpm script

Add to root `package.json`:
```json
"dev:stack:seed-prestashop": "docker compose exec prestashop sh -c 'for f in /tmp/post-install-scripts/*.sh; do sh \"$f\"; done'"
```

The wrapper iterates `*.sh` only — each `.sh` script is responsible for invoking its `.php` companion. This keeps the pnpm-script invocation extension-uniform and lets us add future PHP-backed scripts without changing the wrapper.

Operators run `pnpm dev:stack:seed-prestashop` once after `pnpm dev:stack:up` finishes. Idempotent — re-running is a no-op. The same hook also picks up the existing `10-rename-admin.sh` so it stops being orphaned.

### Documentation

`docs/getting-started.md §1` — add a step between "wait for install" and "log in":

> Once the install completes, run `pnpm dev:stack:seed-prestashop` — this renames the random admin folder to `/admin-dev/`, switches the default currency to **PLN**, and replaces the demo catalogue with 5 fixtures sourced from real Allegro listings (covering the variant × EAN-coverage matrix our codebase exercises).

Plus a short reference table of the 5 fixtures and what each one is testing — useful for new contributors.

### Branch / files

```
docker/prestashop/post-install/20-set-default-currency.sh                (new — shell wrapper)
docker/prestashop/post-install/20-set-default-currency.php               (new — ObjectModel-based currency seed)
docker/prestashop/post-install/30-seed-test-products.sh                  (new — shell wrapper)
docker/prestashop/post-install/30-seed-test-products.php                 (new — ObjectModel-based fixture seed, real Allegro data baked in)
package.json                                                              (edit — new dev:stack:seed-prestashop script)
docs/getting-started.md                                                   (edit — invocation step + fixture reference table)
```

## 4. Step-by-step implementation plan

1. **File the auto-invocation follow-up issue first** — `[DX] Auto-invoke /tmp/post-install-scripts/* after PrestaShop auto-installer completes`. ~5 min of GitHub work; pinned at step 1 so it can't slip past PR ship under "ready to commit" pressure. Link from this PR's body when it opens.
2. **Source real data** — for each fixture row, run a `WebFetch` against an Allegro public listing matching the row's shape. Extract: product name, EAN(s), Kod produktu (producer / SKU), category label, paraphrased 2-3 sentence English description (matches `PS_LANGUAGE=en`).
3. **Write `30-seed-test-products.php`** — PS bootstrap (legacy, with the "do not modernise" header note), idempotency guard, framework-based wipe with `OL-` / `OP-` preserve, then five `Product::add()` blocks. Variants 3-5 use explicit `Combination::add()` + `addAttributeCombinationMultiple()` (committed pattern). Each fixture block prefixed with a comment naming the source Allegro **category** (not URL — categories are stable, listings rotate).
4. **Write `30-seed-test-products.sh`** — `command -v php` guard, then `exec php -d memory_limit=256M /tmp/post-install-scripts/30-seed-test-products.php`.
5. **Write `20-set-default-currency.php`** — PS bootstrap (same legacy header note), `Currency::add()` if missing, `Configuration::updateValue('PS_CURRENCY_DEFAULT', $id)`, early-exit guard.
6. **Write `20-set-default-currency.sh`** — same wrapper pattern as step 4.
7. **Add the pnpm script** in root `package.json` (single line, iterates `*.sh` only).
8. **Update `docs/getting-started.md`** — new invocation step + 5-row fixture reference table + a one-line note documenting the `OL-` / `OP-` reference-prefix convention so operators know how to mark hand-added test products as keep-safe.
9. **Smoke verification** (manual, documented in PR description):
   - `docker volume rm openlinker_prestashop_data && pnpm dev:stack:up` — wait for auto-install to complete (~2-3 min)
   - `pnpm dev:stack:seed-prestashop` — runs `10-`, `20-`, `30-` in order
   - **Re-run `pnpm dev:stack:seed-prestashop` immediately** — verifies idempotency (zero errors, no duplicate rows, second-run output reads "already present, skipping")
   - PS admin → Localisation → Currencies: PLN is default, EUR + USD remain active
   - PS admin → Catalog → Products: exactly the 5 fixtures, each with the correct EAN/reference/variant shape per the matrix
   - Spot-check fixture 4 (partial-EAN variant): one combination has an EAN, one doesn't — proves the offer-link-by-barcode "unique-match-only" path will exercise correctly

## 5. Validate against architecture & standards

- ✅ **Layer**: DX only. No CORE / Integration / Interface / Frontend code touched.
- ✅ **Naming**: shell scripts use `NN-kebab-name.sh` matching the existing `10-rename-admin.sh`. PHP companions use the same `NN-kebab-name.php` stem.
- ✅ **Idempotency**: every script self-guards via early-exit checks (currency-already-set, fixtures-already-present). Smoke verification explicitly tests double-invocation.
- ✅ **No secrets in code**: PS credentials and DB creds come from existing `docker-compose.yml`. PS bootstrap inherits the same env via `config.inc.php`.
- ✅ **No `synchronize: true`-class footguns**: no migrations, no ORM. ObjectModel writes go through the same path the admin UI uses.
- ✅ **No raw SQL fragility**: framework-owned cascade + FK ordering + multistore handling.
- ✅ **Tests**: not applicable for one-off seed scripts; smoke verification documented in the PR description (precedent: `docs/migrations.md`).
- ✅ **Docs updated**: `getting-started.md` reflects the new step + fixture reference table.
- ⚠️ **Auto-invocation gap**: noted; tracked as a separate issue filed before PR opens. Out of scope for #521.

## Risks & open questions (post-tech-review)

1. **PS schema drift across image tags.** Substantially mitigated by the Pattern B pivot — the ObjectModel API is stable across PS minor versions even when the underlying schema shifts. Risk only materialises on a major (PS 9.x → 10.x) bump.
2. **DELETE-via-`Product::delete()` cascade.** Framework-owned now; we no longer hand-write the cascade table list. If a future PS version adds a new related table, `Product::delete()` is updated upstream — we get it for free.
3. **PHP CLI availability inside the container.** The upstream `prestashop/prestashop:9.0.2-2.0-classic-8.4` image ships PHP CLI (used by `bin/console` itself). Mitigated by `command -v php` guard at the top of each `.sh` wrapper.
4. **WebFetch reliability for Allegro listings.** Implementation step 1 only; pure paperwork (the seed file is static once written). If a URL fails, pick a different listing in the same category.
5. **Real-data ageing.** Real EANs / Kod produktu values reference real products that may be delisted from Allegro over time. The fixtures still work in PS regardless; only the human "go re-verify on allegro.pl" reference rots. Per-fixture comment in the PHP file points at the Allegro **category** rather than a specific URL — categories are stable, listings rotate.
