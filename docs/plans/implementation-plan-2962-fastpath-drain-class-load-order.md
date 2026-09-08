# Implementation plan — #2962: `scheduleFastPathDrain()` loads `WebhookSender` before it calls it

**Issue:** [#2962](https://github.com/openlinker-project/openlinker/issues/2962)
**Branch:** `2962-fix-fastpath-drain-class-load-order`
**Scope:** `apps/prestashop-module/openlinker` only. No TypeScript, no schema, no API surface.

## 1. The defect

`OpenLinker::scheduleFastPathDrain()` (`apps/prestashop-module/openlinker/openlinker.php`) calls
`WebhookSender::fastPathAvailable()` at line 2153, then computes `$classesDir` at line 2157, then
registers a shutdown closure whose body contains the
`if (!class_exists('WebhookSender')) { require_once(...); }` guard — roughly 20 lines *below* the
static call it was needed for.

On any request where nothing else has already pulled the class in, PHP raises a fatal
`Class "WebhookSender" not found`. Three hook handlers call this method:

| Hook | Method | What a fatal costs |
|---|---|---|
| `actionValidateOrderAfter` | `hookActionValidateOrderAfter` | aborts **order validation** — the shop's own checkout |
| `actionOrderHistoryAddAfter` | `hookActionOrderHistoryAddAfter` | aborts the order status-change path |
| `actionUpdateQuantity` | `hookActionUpdateQuantity` | aborts the stock-change path |

All three call the *same* static method, so one fix covers all three. The call is the last statement
in each handler, deliberately outside the handler's own `try`/`catch (Throwable)` — so nothing in
the module catches it.

It is load- and route-dependent (it fires only when the class is not already loaded), which is why
it survived review.

### A second, latent fatal in the same function

The shutdown closure's `catch (Throwable $e)` handler calls `WebhookSender::getErrorMessage($e)`.
Today that class is loaded *inside the `try`*, so if the `require_once` itself ever failed, the
catch handler would fatal too — inside a shutdown function, where nothing can report it. The same
fix closes this, and doing so is the reason to hoist the load rather than only guard the call site.

## 2. The fix

Inside `scheduleFastPathDrain()`, after the `self::$fastPathDrainScheduled` latch and before the
`fastPathAvailable()` call:

1. Hoist `$classesDir = dirname(__FILE__) . '/classes/';`.
2. Add the module's standard guard — `if (!class_exists('WebhookSender')) { require_once($classesDir . 'WebhookSender.php'); }` — the identical shape used at every other `WebhookSender` / `OutboxRepository` call site in this file.
3. Delete the now-provably-dead duplicate guard inside the closure, and state the invariant in a comment: the class is loaded before `register_shutdown_function` precisely so the closure's own catch handler can call `WebhookSender::getErrorMessage()`.

### What must NOT move

- **`self::$fastPathDrainScheduled`** stays the first thing the function touches. It is the
  re-entrancy latch; a hook that fires twice in one request must schedule one drain, and it must
  latch even on hosts where the fast path is unavailable.
- **`register_shutdown_function` + `ignore_user_abort` + `fastcgi_finish_request()`** stay exactly
  as they are, in that order. That is the mechanism that flushes the buyer's response before the
  drain runs; the fix adds nothing above or between them.
- **The closure's `catch (Throwable)` stays log-only.** The cron controller still owns these outbox
  rows either way, so a fast-path failure must never surface to the buyer.

### Amended after `/tech-review` round 1: the load itself must not fatal either

Hoisting the `require_once` alone trades a `Class "WebhookSender" not found` fatal for a
`require_once` fatal **on the same hook**. A failed `require_once` is `E_COMPILE_ERROR` and is *not*
catchable by the `catch (Throwable)` blocks in the hook bodies, so an incomplete module upload — a
real deployment mode for PrestaShop modules, which ship by ZIP/FTP — would still abort checkout.

The module already carries the safer idiom for exactly this, in
`OutboxRepository::worstCaseDeliverySeconds()` (`classes/OutboxRepository.php:1320`):
`class_exists` → `file_exists` → `require_once` → re-check `class_exists` → degrade. The final shape
adopts it:

1. `class_exists` → `file_exists($senderPath)` → `require_once($senderPath)`.
2. Re-check `class_exists`; if still absent, **log at warning level and return** — the fast path is
   an optimisation and the cron controller still owns the outbox rows, so this is the same degraded
   mode a host without `fastcgi_finish_request` already has.
3. Only past that re-check is the shutdown callback registered.

Step 3 is what keeps the closure's `catch (Throwable)` safe: it calls
`WebhookSender::getErrorMessage($e)`, so a closure registered with the class absent would fatal
**inside a shutdown handler**, where nothing can report it. The early return makes the class present
there by construction, so the closure carries no `WebhookSender` load at all.

The log exists because a silent degrade would leave the fast path off forever with nothing to find;
it is bounded to once per request by the latch.

`composer.json` autoloads `classes/` under **`autoload-dev` only**, and nothing on the hook path
loads `WebhookSender` transitively — so the original fatal was reliably reachable rather than merely
load-dependent.

### Accepted cost

On a host with no fast path (plain mod_php, CLI), `WebhookSender.php` is now `require_once`d on
every order/stock hook and then the function returns without using it — one small include of a
side-effect-free class file (no `_PS_VERSION_` exit guard, no file-scope statements).

The alternative — inlining `function_exists('fastcgi_finish_request') && function_exists('ignore_user_abort')`
to avoid the include — is rejected: it makes a second, drifting copy of the availability rule that
`WebhookSender::fastPathAvailable()` exists to be the single definition of.

## 3. Regression test

`tests/Unit/ModuleHookRegistrationTest.php` establishes the pattern for this exact class of
mistake: `openlinker.php` cannot be loaded in PHPUnit (it extends PrestaShop's `Module` and pulls
half the framework), so its invariants are asserted by reading the source. A load-order bug is the
same shape of "silent at runtime" defect those tests exist for.

Add `tests/Unit/ModuleFastPathDrainLoadOrderTest.php` asserting, over the
`scheduleFastPathDrain()` source body:

- the `require_once` of `WebhookSender.php` appears **before** the first `WebhookSender::` static reference;
- `$classesDir` is assigned before that `require_once`;
- the latch and `register_shutdown_function`/`fastcgi_finish_request` ordering is intact;
- all three hook handlers still call `self::scheduleFastPathDrain()`.

The first assertion fails against `main` — that is what makes the test worth having.

## 4. No module version bump

`openlinker.php` declares `$this->version = '1.10.0'` and `upgrade/` holds one script per version.
Every script there seeds configuration or migrates schema (`upgrade-1.10.0.php` seeds the outbox run
budget and stale threshold). This change touches neither, and the precedent for a pure-code module
fix is explicit: #1117 (`fix(ps-module): correct EventIdGenerator method call in ping.php`) changed
module PHP with **no** version bump and **no** upgrade script. Bumping the version here would
require inventing an empty `upgrade-1.10.1.php`, which asserts a migration that does not exist.

## 5. Verification

- `pnpm test:php` (`composer install && vendor/bin/phpunit`) — the acceptance criterion.
- `php -l` on every touched file.
- `pnpm lint && pnpm type-check && pnpm test` — the repo gate; the invariant scripts under
  `pnpm check:invariants` walk the whole tree, so a PHP-only change must still leave it green.

**Host limitation:** no `php` binary and no Docker on this machine. Whatever cannot run locally is
reported as not-run, never as passed, and the manual verification for a reviewer is spelled out in
the PR/report.
