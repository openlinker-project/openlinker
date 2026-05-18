# Implementation Plan — #515: PS Module Dynamic-Shipping CarrierModule Capability

**Issue**: [#515](https://github.com/openlinker-project/openlinker/issues/515) — _PS module: dynamic-shipping `CarrierModule` capability_
**Epic**: [#513](https://github.com/openlinker-project/openlinker/issues/513) — _PrestaShop dynamic shipping via OL carrier module_
**Depends on**: #514 (module rename — landed via PR #520 → `apps/prestashop-module/openlinker/`)
**Unblocks**: #516 (PS adapter sidecar write), #517 (FE picker), #518 (cleanup)

---

## 1. Understand the Task

### Goal

Add a **second capability** to the (now multi-capability) PrestaShop module: register an OL-owned dynamic-pricing carrier on install, expose a sidecar table for per-cart shipping costs, and accept HMAC-signed POSTs from the OL backend that upsert sidecar rows. PrestaShop's own order-create flow then queries the carrier module for shipping cost via `getOrderShippingCostExternal($cart)`, which reads from the sidecar — making OL's value authoritative without any post-create reconcile.

### Layer classification

**Infrastructure / external** — pure PHP module work inside `apps/prestashop-module/openlinker/`. Zero TypeScript code, zero CORE / Integration boundary impact, zero OpenLinker DB schema changes. The TS adapter side that *uses* this endpoint is #516, not this PR.

### Explicit non-goals (carried from issue + epic)

- **Backfill of orders synced under the reconcile-PUT path** (`current_state=8`). One-shot SQL is straightforward if needed; not part of #515.
- **Per-Allegro-method PS-carrier clones** (e.g. "OL Dynamic — DPD") for accurate carrier-name display in PS UI. Future enhancement once operators ask.
- **Removing the existing webhook outbox** capability. The carrier capability lives alongside it in the same module class.
- **Multistore carrier registration** — single-store install per the existing module pattern (`installTab()`, `createOutboxTable()` are also single-store).
- **PHPUnit harness for the module** — repo has no PHP test infrastructure. Manual smoke verification documented in PR description per issue acceptance.
- **Tax-excl-on-the-wire mode** — MVP returns `amount_tax_incl` from `getOrderShippingCostExternal`, matching existing reconcile behaviour. Sidecar table stores both columns so a future tax-excl mode is a one-line switch.

---

## 2. Research the Codebase

### Existing module patterns to reuse / mirror

| Pattern | Location | How #515 reuses it |
|---|---|---|
| Module-class shape (`OpenLinker extends Module`, `install()` / `uninstall()` lifecycle, `Configuration::` keys, `PrestaShopLogger` calls with `'OpenLinker:'` prefix) | `openlinker.php` | Extend `OpenLinker` to also extend behaviour required by `CarrierModule` interface; add carrier registration to `install()` and soft-delete to `uninstall()` |
| Sidecar table install via `Db::getInstance()->execute('CREATE TABLE IF NOT EXISTS …')` | `openlinker.php::createOutboxTable()` | Mirror for `createCartShippingTable()` |
| Drop-table-on-uninstall opt-in pattern (commented-out call site) | `openlinker.php::uninstall()` + `dropOutboxTable()` | New `dropCartShippingTable()`. Match the established pattern exactly: method exists, call site is **commented out by default** so the sidecar table survives uninstall (lower blast radius; operator can opt in by uncommenting after confirming no in-flight cart-shipping rows are still referenced by recent orders) |
| Front controller for HMAC-style auth (`/index.php?fc=module&module=openlinker&controller=cron&token=…`) | `controllers/front/cron.php` | Pattern for new `controllers/front/cartshipping.php`. **Difference**: cron uses a static token, cartshipping uses HMAC over body — same shared-secret config key (`OPENLINKER_WEBHOOK_SECRET`) |
| HMAC signature contract (`sha256=<hex>`, `X-OpenLinker-Timestamp`/`X-OpenLinker-Signature`, signed payload = `timestamp + '.' + rawBody`, ±5 min skew window, `timingSafeEqual` / PHP `hash_equals`) | TS receiver: `apps/api/src/webhooks/application/services/webhook-auth.service.ts:34-129`. PHP signer: `apps/prestashop-module/openlinker/classes/WebhookSender.php:69-83` | New PHP **receiver** in `classes/HmacRequestVerifier.php` mirrors the contract bit-for-bit so the OL backend's existing outbound signer (#516) just works |
| Class-loading pattern in front controllers (`require_once` with `class_exists` guards on each used class) | `controllers/front/cron.php:50-63` | Same pattern in the new front controller |

### External research — canonical PrestaShop carrier-module patterns

Because the OL module standards (`docs/engineering-standards.md`) are silent on PHP and this is the project's first carrier module, I cross-checked the design against the established PS-ecosystem patterns:

- **Official docs** ([devdocs.prestashop-project.org/8/modules/carrier/](https://devdocs.prestashop-project.org/8/modules/carrier/)) — soft-delete is canonical (`deleted=true`). Editing a carrier in the BO **duplicates the row and assigns a new `id_carrier`**, so tracking via `actionCarrierUpdate` is required.
- **LP Express PS module** ([github.com/zefy/lp-express-shipping-method-for-prestashop](https://github.com/zefy/lp-express-shipping-method-for-prestashop/blob/master/lpexpress.php)) — production-grade reference. Confirms: use `$carrier->addZone($id)` method (not raw `Db::insert`); logo copy is **fail-fast** (`if (!copy(...)) return false;` — install aborts if missing); uninstall reassigns `PS_CARRIER_DEFAULT` to the next active non-OL carrier *before* soft-deleting (otherwise checkout breaks).
- **BelVG carrier-module tutorial** ([belvg.com/blog/how-to-create-shipping-module-for-prestashop](https://belvg.com/blog/how-to-create-shipping-module-for-prestashop.html)) — confirms loop-over-`Zone::getZones(true)` is the right default for an aggregator that doesn't know operator zones a priori.

These three sources independently agree on the patterns the OL standards don't cover. The risk section below was rewritten after this research.

### What does *not* exist and must be created

- The `OpenLinker` class currently extends `Module` (post-#514). For #515 it must extend **`CarrierModule`** instead — PS's canonical abstract class for carrier modules (in core: `classes/module/CarrierModule.php`, since PS 1.5+). `CarrierModule` itself extends `Module`, so all existing webhook-outbox behaviour is preserved unchanged. Extending `CarrierModule` declares the capability formally — the duck-typed alternative (just adding the two methods on a plain `Module` subclass) works at runtime but is non-canonical and surprises any reader familiar with PS conventions. LP Express, every official PS carrier module, and the PS core docs all assume `extends CarrierModule`.
- A `CartShippingRepository` class (sidecar I/O). Mirrors `OutboxRepository`'s shape (constructor takes `tableName`, simple CRUD, integer-cast IDs, parameterized values via `pSQL`/intval — no string interpolation of body fields).
- The HMAC-receiver helper class.

### Related docs / standards consulted

- `docs/architecture-overview.md §4 Webhook Ingestion Flow` — canonical webhook contract definition (HMAC SHA256, timestamp window, raw body verification). The new endpoint is webhook-shaped (HMAC POST from the OL backend → write to sidecar) and follows the same contract by design.
- `docs/engineering-standards.md` — silent on PHP; applies to TS only. PHP follows PrestaShop module conventions (existing module already does so consistently after #514).
- `docs/migrations.md` — N/A. This change adds a *MySQL* table inside PS's own DB via the module's install hook, not a TypeORM migration in the OL Postgres.

---

## 3. Design

### Data flow (this PR's scope only — #516 wires the upstream side)

```
OL backend                                    PS module (this PR)
─────────                                     ──────────────────
                  POST /index.php?fc=module
                  &module=openlinker
                  &controller=cartshipping
   ─────────────────────────────────────►    cartshipping front controller
   X-OpenLinker-Timestamp: <ms>                │
   X-OpenLinker-Signature: sha256=<hex>        │ 1. read raw body
   { id_cart, amount_tax_excl,                 │ 2. HmacRequestVerifier::verify()
     amount_tax_incl, source }                 │    ├─ check ts within ±5 min
                                               │    ├─ recompute HMAC
                                               │    └─ hash_equals
                                               │ 3. validate JSON shape
                                               │ 4. CartShippingRepository::upsert()
   ◄──────────────────────────────── 200 {ok:true, id_cart}

later, when an OL adapter creates an order:
  PS Cart::getOrderTotal(cart, with-shipping)
    → Carrier::getOrderShippingCost(cart, ..., $module = OL)
       → $module->getOrderShippingCost($params, $shipping_cost)   (on OpenLinker class)
          → $module->getOrderShippingCostExternal($cart)
             → Db::getRow('SELECT amount_tax_incl FROM …openlinker_cart_shipping WHERE id_cart=?')
             → return (float) row['amount_tax_incl']             ← authoritative
```

### File-level design

```
apps/prestashop-module/openlinker/
├── openlinker.php                                    [MODIFIED] install/uninstall + 2 carrier methods + actionCarrierUpdate hook
├── carrier.jpg                                       [NEW]      carrier logo (REQUIRED by PS — install aborts without it)
├── classes/
│   ├── HmacRequestVerifier.php                       [NEW]      receiver-side HMAC verification
│   └── CartShippingRepository.php                    [NEW]      sidecar-table I/O
├── controllers/
│   ├── admin/AdminOpenLinkerController.php           [unchanged]
│   └── front/
│       ├── cron.php                                  [unchanged]
│       └── cartshipping.php                          [NEW]      HMAC-authed POST handler
└── README.md                                          [MODIFIED] new "Dynamic shipping carrier" section
```

### Class shapes (skeletons, not full code)

**`OpenLinker` (modifications to existing class):**

```php
// In install():
//   1. createCartShippingTable()       → CREATE TABLE IF NOT EXISTS …openlinker_cart_shipping
//   2. installDynamicCarrier()          → Carrier::add() + loop addZone() over all active zones
//                                         + copy carrier.jpg → _PS_SHIP_IMG_DIR_ (FAIL on copy error)
//      → Configuration::updateValue('OPENLINKER_DYNAMIC_CARRIER_ID', $carrier->id)
//   3. registerHook('actionCarrierUpdate')   → CRITICAL: PS duplicates carrier on BO edit
//                                              and reassigns id_carrier; hook keeps the
//                                              Configuration key in sync with the live row

// In uninstall():
//   1. uninstallDynamicCarrier()        → check if our carrier is PS_CARRIER_DEFAULT;
//                                          if yes, reassign to next active non-OL carrier
//                                          BEFORE soft-deleting (otherwise checkout breaks)
//                                        → soft-delete: $c->deleted=1; $c->update()
//                                          (preserves order history; PS pattern)
//      → Configuration::deleteByName('OPENLINKER_DYNAMIC_CARRIER_ID')
//   2. unregisterHook('actionCarrierUpdate')
//   3. dropCartShippingTable()          → DROP TABLE IF EXISTS …  (commented out by default
//                                         to match the outbox-table opt-in pattern)

// New methods called by PS at order-total time:
public function getOrderShippingCost($params, $shipping_cost)
{
    return $this->getOrderShippingCostExternal($params);
}

public function getOrderShippingCostExternal($params)
{
    $cartId = (int) $params->id;
    $repo = $this->getCartShippingRepository();   // lazy require_once + instantiate
    $row = $repo->findByCartId($cartId);

    if (!$row) {
        PrestaShopLogger::addLog(
            'OpenLinker: no cart-shipping row for id_cart=' . $cartId
            . ' — refusing to ship via OL dynamic carrier',
            3, /* error */ null, 'Cart', $cartId
        );
        return false;  // PS treats false as "carrier unavailable"
    }

    return (float) $row['amount_tax_incl'];
}

// CRITICAL hook — PS docs: "editing a carrier in BO duplicates the row and assigns
// a new id_carrier". Without this hook the OPENLINKER_DYNAMIC_CARRIER_ID Config key
// goes stale on the first BO edit, breaking dynamic-carrier resolution silently.
public function hookActionCarrierUpdate($params)
{
    $idOld = (int) $params['id_carrier'];
    $idNew = (int) $params['carrier']->id;
    if ($idOld === (int) Configuration::get('OPENLINKER_DYNAMIC_CARRIER_ID')) {
        Configuration::updateValue('OPENLINKER_DYNAMIC_CARRIER_ID', $idNew);
    }
}
```

**Carrier install — concrete pattern (matches LP Express + BelVG):**

```php
private function installDynamicCarrier()
{
    $carrier = new Carrier();
    $carrier->name              = 'OpenLinker Dynamic';
    $carrier->active            = 1;
    $carrier->deleted           = 0;
    $carrier->shipping_handling = false;
    $carrier->range_behavior    = 0;
    $carrier->is_module         = true;
    $carrier->shipping_external = true;
    $carrier->external_module_name = 'openlinker';
    $carrier->need_range        = false;          // OL dynamic — no PS range tables
    // CRITICAL: OL supplies an authoritative tax-incl amount via the sidecar.
    // id_tax_rules_group=0 means PS does NOT add tax on top — otherwise every
    // order would be double-taxed (PS would multiply our tax-incl value by
    // the shop tax rate). Documented in the cartshipping endpoint contract.
    $carrier->id_tax_rules_group = 0;

    foreach (Language::getLanguages(true) as $lang) {
        $carrier->delay[(int) $lang['id_lang']] = 'OpenLinker dynamic shipping';
    }

    if (!$carrier->add()) {
        return false;
    }

    // Assign all currently-active zones — operator can disable from carrier admin
    foreach (Zone::getZones(true) as $zone) {
        $carrier->addZone((int) $zone['id_zone']);
    }

    // Logo is REQUIRED — PS shows broken-image placeholder otherwise, and most
    // production modules treat copy-failure as install failure. Match that pattern.
    $logoSrc = dirname(__FILE__) . '/carrier.jpg';
    $logoDst = _PS_SHIP_IMG_DIR_ . '/' . (int) $carrier->id . '.jpg';
    if (!copy($logoSrc, $logoDst)) {
        return false;
    }

    Configuration::updateValue('OPENLINKER_DYNAMIC_CARRIER_ID', (int) $carrier->id);
    return true;
}

private function uninstallDynamicCarrier()
{
    $carrierId = (int) Configuration::get('OPENLINKER_DYNAMIC_CARRIER_ID');
    if (!$carrierId) {
        return true;
    }

    // If our carrier is the shop default, reassign before soft-deleting to keep
    // checkout functional. Pattern from LP Express uninstall.
    if ((int) Configuration::get('PS_CARRIER_DEFAULT') === $carrierId) {
        $carriers = Carrier::getCarriers(
            (int) Configuration::get('PS_LANG_DEFAULT'),
            true,  // active only
            false, false, null,
            PS_CARRIERS_AND_CARRIER_MODULES_NEED_RANGE
        );
        foreach ($carriers as $c) {
            if ($c['active'] && !$c['deleted'] && $c['external_module_name'] !== $this->name) {
                Configuration::updateValue('PS_CARRIER_DEFAULT', (int) $c['id_carrier']);
                break;
            }
        }
    }

    $carrier = new Carrier($carrierId);
    $carrier->deleted = 1;
    $carrier->update();

    Configuration::deleteByName('OPENLINKER_DYNAMIC_CARRIER_ID');
    return true;
}
```

**`HmacRequestVerifier` (new class):**

```php
class HmacRequestVerifier
{
    const SKEW_WINDOW_MS = 300000;  // 5 minutes — matches WebhookAuthService.DEFAULT_SKEW_WINDOW_MS

    /**
     * @return true on success
     * @throws Exception with one of: 'missing-headers' | 'bad-signature-format'
     *                  | 'timestamp-out-of-window' | 'invalid-signature' | 'misconfigured'
     */
    public static function verify($rawBody, $timestampHeader, $signatureHeader, $secret)
    {
        if ($timestampHeader === null || $signatureHeader === null) {
            throw new Exception('missing-headers');
        }
        if (empty($secret)) {
            throw new Exception('misconfigured');  // OPENLINKER_WEBHOOK_SECRET not set
        }
        if (strpos($signatureHeader, 'sha256=') !== 0) {
            throw new Exception('bad-signature-format');
        }
        $providedHex = substr($signatureHeader, 7);
        if (!preg_match('/^[0-9a-f]{64}$/i', $providedHex)) {
            throw new Exception('bad-signature-format');
        }

        $ts = (int) $timestampHeader;
        if ($ts <= 0) {
            throw new Exception('timestamp-out-of-window');
        }
        $nowMs = (int) (microtime(true) * 1000);
        if (abs($nowMs - $ts) > self::SKEW_WINDOW_MS) {
            throw new Exception('timestamp-out-of-window');
        }

        $signedPayload = $timestampHeader . '.' . $rawBody;
        $expectedHex = hash_hmac('sha256', $signedPayload, $secret);

        if (!hash_equals($expectedHex, $providedHex)) {
            throw new Exception('invalid-signature');
        }

        return true;
    }
}
```

**`CartShippingRepository` (new class):**

```php
class CartShippingRepository
{
    private $tableName;

    public function __construct()
    {
        $this->tableName = _DB_PREFIX_ . 'openlinker_cart_shipping';
    }

    /** @return array|null assoc row or null */
    public function findByCartId($idCart)
    {
        $idCart = (int) $idCart;
        $sql = 'SELECT amount_tax_incl, amount_tax_excl, source
                FROM `' . $this->tableName . '`
                WHERE id_cart = ' . $idCart;
        $row = Db::getInstance()->getRow($sql);
        return $row !== false && $row !== null ? $row : null;
    }

    /** @return bool */
    public function upsert($idCart, $amountTaxExcl, $amountTaxIncl, $source = null)
    {
        $idCart = (int) $idCart;
        $taxExcl = (float) $amountTaxExcl;
        $taxIncl = (float) $amountTaxIncl;
        $sourceSql = $source === null ? 'NULL' : "'" . pSQL($source) . "'";

        $sql = 'INSERT INTO `' . $this->tableName . '`
                  (id_cart, amount_tax_excl, amount_tax_incl, source)
                VALUES (' . $idCart . ', ' . $taxExcl . ', ' . $taxIncl . ', ' . $sourceSql . ')
                ON DUPLICATE KEY UPDATE
                  amount_tax_excl = VALUES(amount_tax_excl),
                  amount_tax_incl = VALUES(amount_tax_incl),
                  source          = VALUES(source),
                  updated_at      = CURRENT_TIMESTAMP';

        return (bool) Db::getInstance()->execute($sql);
    }
}
```

**`controllers/front/cartshipping.php` (new):**

```php
class OpenLinkerCartShippingModuleFrontController extends ModuleFrontController
{
    public function initContent()
    {
        // Bypass PS theme rendering — JSON only
        parent::initContent();

        // 1. Method check
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->jsonError(405, 'method-not-allowed');
            return;
        }

        // 2. Load helpers
        require_once $this->module->getLocalPath() . 'classes/HmacRequestVerifier.php';
        require_once $this->module->getLocalPath() . 'classes/CartShippingRepository.php';

        // 3. HMAC verify (read raw body BEFORE PS touches it)
        $rawBody         = (string) file_get_contents('php://input');
        $timestampHeader = $this->headerValue('HTTP_X_OPENLINKER_TIMESTAMP');
        $signatureHeader = $this->headerValue('HTTP_X_OPENLINKER_SIGNATURE');
        $secret          = (string) Configuration::get('OPENLINKER_WEBHOOK_SECRET');

        try {
            HmacRequestVerifier::verify($rawBody, $timestampHeader, $signatureHeader, $secret);
        } catch (Exception $e) {
            $this->jsonError(401, $e->getMessage());
            return;
        }

        // 4. Validate JSON shape
        $data = json_decode($rawBody, true);
        if (!is_array($data)
            || !isset($data['id_cart'], $data['amount_tax_excl'], $data['amount_tax_incl'])) {
            $this->jsonError(400, 'invalid-body');
            return;
        }
        $idCart        = (int) $data['id_cart'];
        $amountTaxExcl = $data['amount_tax_excl'];
        $amountTaxIncl = $data['amount_tax_incl'];
        $source        = isset($data['source']) ? (string) $data['source'] : null;

        if ($idCart <= 0 || !is_numeric($amountTaxExcl) || !is_numeric($amountTaxIncl)) {
            $this->jsonError(400, 'invalid-fields');
            return;
        }

        // 5. Upsert
        $repo = new CartShippingRepository();
        $ok = $repo->upsert($idCart, $amountTaxExcl, $amountTaxIncl, $source);
        if (!$ok) {
            $this->jsonError(500, 'persist-failed');
            return;
        }

        $this->jsonOk(['ok' => true, 'id_cart' => $idCart]);
    }

    private function headerValue($key) { ... }   // $_SERVER lookup, returns null if absent
    private function jsonOk(array $body)  { ... }  // header + echo + exit
    private function jsonError($status, $reason) { ... }  // PS-log warning + JSON
}
```

---

## 4. Step-by-Step Implementation Plan

| # | File | Change | Acceptance |
|---|---|---|---|
| **S1** | `apps/prestashop-module/openlinker/classes/HmacRequestVerifier.php` | NEW. Receiver-side HMAC verifier. Constants for skew window match the TS service. Throws specific reason strings. | File parses, all reason strings match the documented set, no PHP warnings on PHP 8.0+ |
| **S2** | `apps/prestashop-module/openlinker/classes/CartShippingRepository.php` | NEW. `findByCartId(int)` and `upsert(int, float, float, ?string)`. All inputs cast to numeric / pSQL'd. No string interpolation of caller body. | `findByCartId` returns `null` for missing row, assoc array for present row; `upsert` is idempotent (calling twice with same values produces same DB state) |
| **S3** | `apps/prestashop-module/openlinker/carrier.jpg` | NEW. Carrier logo file. Simple flat OL mark on neutral background, JPG, ~120×120 px, < 50 KB. **Required** — install aborts if missing (matches LP Express + standard PS module behaviour). | File present; install hook's `copy()` succeeds; PS carrier-list page in BO shows the OL logo next to the row (not the broken-image placeholder) |
| **S4** | `apps/prestashop-module/openlinker/openlinker.php` | MODIFIED. Add `createCartShippingTable()`, `dropCartShippingTable()`, `installDynamicCarrier()`, `uninstallDynamicCarrier()` private methods. Wire from `install()` / `uninstall()`. Register `actionCarrierUpdate` hook in install (and add `hookActionCarrierUpdate($params)` handler — keeps `OPENLINKER_DYNAMIC_CARRIER_ID` in sync after BO edits). Add public `getOrderShippingCost($params, $shipping_cost)` and `getOrderShippingCostExternal($params)`. Match existing log-prefix convention (`'OpenLinker: …'`). | On clean install: (a) `{prefix}openlinker_cart_shipping` table exists with the documented columns; (b) one carrier row exists with `is_module=1`, `shipping_external=1`, `external_module_name='openlinker'`, `name='OpenLinker Dynamic'`, `need_range=0`, `active=1`, `deleted=0`; (c) `Configuration::get('OPENLINKER_DYNAMIC_CARRIER_ID')` returns the carrier id; (d) all currently-active zones are linked to the carrier via `carrier_zone`; (e) `actionCarrierUpdate` hook is registered against the module |
| **S5** | `apps/prestashop-module/openlinker/controllers/front/cartshipping.php` | NEW. Front controller wired by class name (PS auto-registers via `OpenLinker{X}ModuleFrontController` naming). Reads raw body, verifies HMAC, validates body, calls repo, returns JSON. | (a) Unsigned POST → `401 missing-headers`; (b) wrong signature → `401 invalid-signature`; (c) timestamp older than 5 min → `401 timestamp-out-of-window`; (d) valid POST → `200 {ok:true, id_cart}` and row visible in DB; (e) GET → `405 method-not-allowed` |
| **S6** | `apps/prestashop-module/openlinker/openlinker.php` | MODIFIED. On uninstall: (1) check if our carrier is `PS_CARRIER_DEFAULT`; if yes, reassign to next active non-OL carrier *before* soft-delete (LP Express pattern — otherwise checkout breaks); (2) soft-delete the carrier (`$c->deleted=1; $c->update()`); (3) `Configuration::deleteByName('OPENLINKER_DYNAMIC_CARRIER_ID')`; (4) unregister `actionCarrierUpdate` hook. `dropCartShippingTable()` exists as opt-in, commented out at call site (matches outbox pattern). | After uninstall: (a) if our carrier was the shop default, `PS_CARRIER_DEFAULT` now points at another active carrier; (b) our carrier row remains with `deleted=1` (preserves order history); (c) `OPENLINKER_DYNAMIC_CARRIER_ID` absent; (d) sidecar table preserved (operator can opt into drop); (e) no PHP fatal errors in PS log |
| **S7** | `apps/prestashop-module/openlinker/README.md` | MODIFIED. Add a new section **"Dynamic Shipping Carrier"** documenting: what it is, what it provides, install effects (table + carrier + zones + config key + hook), uninstall behaviour (soft-delete + default-carrier reassignment), the cartshipping endpoint (URL, method, body shape, headers, HMAC contract), example signed-request curl, and a note explaining the `actionCarrierUpdate` hook for operators who edit the carrier in BO. | Reader can implement an integration against the endpoint using only the README, with no need to read the PHP source |

### Verification (manual smoke, per issue acceptance)

PHP module has no automated test harness in this repo. Per `docs/testing-guide.md` quick-reference: only TS unit/integration tests are wired. Manual verification on a dev shop:

1. Spin up the dev stack (`pnpm dev:stack:up`); install the renamed `openlinker` module from PS admin.
2. Verify the install via SQL: confirm carrier row exists with the expected flags, sidecar table exists with the expected columns, `Configuration::get('OPENLINKER_DYNAMIC_CARRIER_ID')` returns the carrier id (use PS Configuration UI or a quick SQL query against `ps_configuration`).
3. POST to the cartshipping endpoint with a curl that signs the body using the configured `OPENLINKER_WEBHOOK_SECRET` (README will include the snippet). Expect `200 {ok:true, id_cart}`.
4. Repeat the POST with a deliberately wrong signature, an old timestamp, and missing headers — expect `401` with the documented reason in each case.
5. Manually create a cart in the dev DB with `id_carrier = OPENLINKER_DYNAMIC_CARRIER_ID`, then call `Cart::getOrderTotal($cart, Cart::ONLY_SHIPPING)`. Expect the value to equal the `amount_tax_incl` written via the endpoint.
6. Delete the sidecar row, repeat step 5: the module's `getOrderShippingCostExternal` returns `false`, an error appears in the PS log, and PS treats the carrier as unavailable.
7. Uninstall the module from PS admin; verify carrier row has `deleted=1`, config key is gone, no PHP fatal errors in the PS log.

---

## 5. Validate

### Architecture compliance

✅ **CORE / Integration boundary**: untouched — this PR is entirely inside the PHP module which sits *outside* the hexagonal layering (it's an external PrestaShop application that PS loads at runtime, not part of `libs/core` or `libs/integrations`).
✅ **Dependency direction**: N/A (PHP module).
✅ **`docs/architecture-overview.md §4 Webhook Ingestion Flow` contract**: the new cartshipping endpoint follows the same HMAC-SHA256 contract the OL TS receiver enforces (timestamp + '.' + body, ±5 min skew, `sha256=<hex>` signature), so the OL backend's existing outbound signer can target it without bespoke code.
✅ **`.claude/rules/backend.md`**: rules apply to TS code; no TS code is modified by this PR. The HMAC receiver mirrors the documented TS verifier line-for-line.

### Naming

✅ Module file naming: PHP follows PrestaShop conventions, not OL's `*.port.ts` / `*.adapter.ts` standards (which target TS only). New PHP classes follow the existing module convention: `PascalCase.php` matching the class name (`HmacRequestVerifier`, `CartShippingRepository`). Front controller class follows PS auto-discovery: `OpenLinker{ControllerName}ModuleFrontController` ↔ `controllers/front/{controllername}.php`.
✅ Config key: `OPENLINKER_DYNAMIC_CARRIER_ID` matches the existing `OPENLINKER_*` namespace convention.
✅ DB table: `openlinker_cart_shipping` matches the existing `openlinker_webhook_outbox` naming pattern (snake_case under `_DB_PREFIX_`).

### Testing strategy

- **Manual smoke** documented above. PR description carries the verification log.
- **No PHP unit tests added** — the module has no PHPUnit harness, and adding one is out of scope per the issue ("No PHP unit-test harness in this repo — keep manual verification in the PR description / issue acceptance").
- **TS quality gate (`pnpm lint && pnpm type-check && pnpm test`)** still runs as a no-op check via the pre-commit hook — no TS code touched, all 1557 tests should remain green.

### Security

- **HMAC contract** mirrors the proven TS receiver: ±5 min replay window, constant-time comparison via `hash_equals`, raw-body signing, sha256 hex format check.
- **No SQL injection**: all sidecar-table inputs cast to int/float; the only string field (`source`) goes through `pSQL()`.
- **Loud failure on missing sidecar row**: PS log error + `return false`. Operator misconfig (carrier mapped but no sidecar row written) surfaces immediately rather than silently shipping at zero.
- **Soft-delete on uninstall**: preserves order history per the standard PS pattern. Sidecar table preserved by default (matches existing outbox-table opt-in pattern); operator can drop manually if desired.
- **Secret reuse**: HMAC uses the existing `OPENLINKER_WEBHOOK_SECRET` config key. No new secret to manage. Any operator who has already configured the webhook outbox is configured for this endpoint too.
- **Replay window — accepted limitation**: the ±5 min skew window is the only replay protection. An attacker who captured one valid request could replay it within 5 minutes and rewrite the sidecar row. Because cart-shipping writes are **idempotent** for the same `(id_cart, amount)` tuple, the only real risk is that an old snapshot overwrites a newer amount — narrow window, narrow blast radius, and matches the threat model documented for the existing TS webhook receiver. Acceptable; not gating.
- **Tax double-charging guard**: install registers the carrier with `id_tax_rules_group = 0` so PS does **not** apply tax on top of the OL-supplied tax-incl amount. The OL backend's contract is therefore "amount_tax_incl is final on the wire". Without this guard, every order placed against the OL Dynamic carrier would be double-taxed (PS would multiply our tax-incl value by the shop tax rate).

### Risks / open questions (rewritten after market research — see §2 "External research" subsection)

- **R1 — `ENGINE=InnoDB` literal.** Confirmed safe. LP Express + BelVG tutorial both use literal `InnoDB`; matches the existing `createOutboxTable()` in this very module. No portability concern on supported PS 8.x.
- **R2 — Zone assignment.** Use `$carrier->addZone((int) $zone['id_zone'])` (the public method on the `Carrier` class) inside a loop over `Zone::getZones(true)`. This is the LP Express pattern adapted for an aggregator that can't pre-pick zones. Operators can prune zones from the carrier admin page after install.
- **R3 — Carrier logo (REVISED — was wrong in v1).** Logo is **effectively required**. LP Express's install returns `false` if the `copy()` fails, and PS shows a broken-image placeholder in the carrier list otherwise. Plan now ships a `carrier.jpg` next to `openlinker.php`, copied to `_PS_SHIP_IMG_DIR_/{id}.jpg` at install. Install **fails fast** on copy error (matches LP Express). Logo commit is a single binary file (~5-50 KB).
- **R4 — Front controllers and CSRF.** PS front controllers don't apply CSRF tokens (they're public endpoints by design). HMAC is the only auth — same model the existing TS webhook receiver uses. No CSRF concern.
- **R5 — Body-size limit.** PS doesn't impose a small limit on front-controller bodies; `php.ini`'s `post_max_size` does (default 8 MB). Cart-shipping payloads are ~100 bytes, so no concern. Not documented.
- **R6 — `actionCarrierUpdate` hook is mandatory.** PS docs are explicit: editing a carrier in the BO **duplicates the row and assigns a new `id_carrier`**. Without the hook, the first time any operator clicks "Save" on the OL Dynamic carrier in BO, `OPENLINKER_DYNAMIC_CARRIER_ID` goes stale and dynamic shipping silently breaks (the OL backend resolves an old id; the new active carrier still has `external_module_name='openlinker'` but the OL adapter writes sidecar rows for the wrong cart-resolution path → `getOrderShippingCostExternal` returns `false` on every order). Plan now registers `actionCarrierUpdate` in install and implements `hookActionCarrierUpdate($params)` to refresh the Configuration key.
- **R7 — `PS_CARRIER_DEFAULT` reassignment on uninstall.** If the OL Dynamic carrier was set as the shop default and we soft-delete it without reassigning, checkout breaks (default carrier points at a `deleted=1` row). Plan now mirrors LP Express's `uninstall()` pattern: probe `PS_CARRIER_DEFAULT`, find the next active non-OL carrier via `Carrier::getCarriers(...)`, reassign, *then* soft-delete.

### Out-of-scope follow-ups (parking lot, do *not* file as new issues now — wait for #516 to land)

- Multistore-aware install (per-shop carrier rows). Defer until an operator hits it.
- Per-Allegro-method carrier clones for richer PS UI display (covered by epic #513 non-goals).
- Tax-excl-on-the-wire mode (sidecar table already stores both columns; one-line switch to return `amount_tax_excl` instead).

---

## Estimated diff size

≈ 400-500 lines added (3 new PHP files + 1 binary `carrier.jpg` + ~160 lines added to `openlinker.php` for install/uninstall/carrier methods/hook + ~70 lines added to README). Zero TS changes. Zero migrations.
