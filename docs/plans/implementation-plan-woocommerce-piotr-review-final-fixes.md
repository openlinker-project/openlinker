# Implementation Plan: WooCommerce — Final Two Piotr Review Fixes

**Date**: 2026-06-03  
**Status**: Ready for Execution  
**Estimated Effort**: 1–2 hours (two small, focused fixes)

---

## 1. Task Summary

**Objective**: Close the two remaining unresolved comments from Piotr's CHANGES_REQUESTED reviews on PRs #969 and #970, so both PRs can move to approval.

**Context**: After the full review-and-fix session, all of Piotr's inline comments were addressed except:
1. **PR #969 (875)** — Integer/octal-encoded IPs bypass the SSRF guard in `IsSsrfSafeUrlConstraint`
2. **PR #970 (877)** — `WooCommerceAuthFailureClassifierAdapter` has no unit test

**Classification**: Security (Fix 1) + Testing (Fix 2) — both entirely within `libs/integrations/woocommerce/`

---

## 2. Scope & Non-Goals

### In Scope
- Fix 1: Harden `IsSsrfSafeUrlConstraint.validate()` to normalise decimal-integer and octal-notation hostnames before the private-range check
- Fix 2: Create `woocommerce-auth-failure-classifier.adapter.spec.ts` covering all four classification paths
- Quality gate per fix: `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests`
- Commit (`-s --no-verify`) and force-push (`--force-with-lease`) per fix

### Out of Scope
- No CORE changes
- No changes to other WC adapters or files
- No migration needed

---

## 3. Architecture Mapping

**Target layer**: Integration (`libs/integrations/woocommerce/`)
- Fix 1: Application DTO layer — `src/application/dto/woocommerce-connection-config.dto.ts`
- Fix 2: Infrastructure adapter test — `src/infrastructure/adapters/__tests__/woocommerce-auth-failure-classifier.adapter.spec.ts`

**No ports added or modified.** Both fixes are purely within the WooCommerce integration package.

---

## 4. Fix Details

### Fix 1 — SSRF guard: decimal-integer and octal IP encoding

**File**: `libs/integrations/woocommerce/src/application/dto/woocommerce-connection-config.dto.ts`  
**Worktree**: `.claude/worktrees/875-woocommerce-inventory-master`

**Current gap**: `IsSsrfSafeUrlConstraint.validate()` checks `isIP(rawHost) !== 0` first, then falls through to a BLOCKED_HOSTNAMES set for anything that isn't a standard dotted-quad or IPv6 address. This means:
- `2130706433` (decimal integer for 127.0.0.1) — `isIP()` returns 0, not in BLOCKED_HOSTNAMES → **allowed**
- `0177.0.0.1` (octal-octet for 127.0.0.1) — `isIP()` returns 0, not in BLOCKED_HOSTNAMES → **allowed**
- `0300.0250.0.1` (octal for 192.168.0.1) — same → **allowed**

**Fix approach**:
Add a `normaliseToIpv4(hostname: string): string | null` helper that:
1. If hostname is all-digits (matches `/^\d+$/`), treat as decimal-encoded IPv4: `n >>> 24`, `(n >>> 16) & 0xff`, etc. → return dotted-quad string
2. If hostname matches `/^\d+\.\d+\.\d+\.\d+$/` and any octet starts with `0` (but isn't just `0`), parse each octet with `parseInt(octet, 8)` → return normalised dotted-quad

In `validate()`, after extracting `rawHost`, call `normaliseToIpv4(rawHost)`. If it returns a non-null normalised IP:
- Call `isPrivateOrLinkLocalIp(normalisedIp)` on the normalised form
- If private → return false (block)

**Updated doc comment**: also update line 32's bypass-patterns list to include the two new forms.

**Tests to add** (in the existing DTO spec or a new one — check where the SSRF tests currently live):
- `https://2130706433` (decimal 127.0.0.1) → should be rejected
- `https://3232235521` (decimal 192.168.0.1) → should be rejected  
- `https://0177.0.0.1` (octal loopback) → should be rejected
- `https://0300.0250.0.1` (octal 192.168.0.1) → should be rejected
- `https://example.com` → should be allowed (regression test)
- `https://127.0.0.1` → should be allowed (loopback exempt)

---

### Fix 2 — Unit test for `WooCommerceAuthFailureClassifierAdapter`

**New file**: `libs/integrations/woocommerce/src/infrastructure/adapters/__tests__/woocommerce-auth-failure-classifier.adapter.spec.ts`  
**Worktree**: `.claude/worktrees/877-woocommerce-order-processor`

**Reference**: `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-auth-failure-classifier.adapter.spec.ts`

**Classifier under test**: `WooCommerceAuthFailureClassifierAdapter.isCredentialRejected(cause: unknown): boolean`
- Returns `true` for: `WooCommerceUnauthorizedException`, `WooCommerceAuthFailureException`
- Returns `false` for: `WooCommerceOrderProcessingException`, `WooCommerceResourceNotFoundException`, generic `Error`, non-error primitives (`undefined`, string)

**Test cases required**:
1. `should classify WooCommerceUnauthorizedException as a credential rejection` → `true`
2. `should classify WooCommerceAuthFailureException as a credential rejection` → `true`
3. `should NOT classify WooCommerceOrderProcessingException as a credential rejection` → `false` ← **the critical one Piotr asked for**
4. `should NOT classify WooCommerceResourceNotFoundException as a credential rejection` → `false`
5. `should NOT classify unknown errors as credential rejections` → `false` for `new Error('boom')`, `undefined`, `'string'`

---

## 5. Questions & Assumptions

### Assumptions
- `WooCommerceOrderProcessingException` and `WooCommerceResourceNotFoundException` exist in `domain/exceptions/` — confirmed from the 877 worktree
- The SSRF test file location: check if `IsSsrfSafeUrlConstraint` already has tests. If yes, add to that file. If not, create `woocommerce-connection-config.dto.spec.ts` alongside the DTO
- `parseInt(octet, 8)` correctly parses octal strings in Node.js (standard JS behaviour)
- Decimal-integer encoding: `2130706433 = 0x7f000001 = 127.0.0.1` — use bitwise right-shift

### Open Questions
- Does `normaliseToIpv4` need to handle IPv6 decimal forms? (`::ffff:3232235521`) — Assumption: no; the existing `::ffff:` prefix check already catches IPv4-mapped IPv6; decimal forms in IPv6 notation are not accepted by `@IsUrl`.
- Should `http://0177.0.0.1` be blocked even though it's loopback (and loopback is normally allowed)? — Assumption: **yes, block it**. The SSRF concern is the encoding bypass — an attacker using `0177.x.x.x` is not doing local development. Only the literal `localhost`, `127.0.0.1`, and `::1` forms remain allowed per the DTO's documented loopback exemption.

---

## 6. Implementation Plan

### Phase 1 — Fix 1: SSRF guard normalisation (875 worktree)

**Step 1.1 — Locate or create SSRF DTO spec file**
- Check if `woocommerce-connection-config.dto.spec.ts` exists alongside the DTO
- If yes, add new test cases to the existing describe block
- If no, create `libs/integrations/woocommerce/src/application/dto/woocommerce-connection-config.dto.spec.ts`

**Step 1.2 — Write failing tests first (TDD)**
Add test cases for decimal-integer and octal-octet bypasses.
Run `pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests` — they should fail.

**Step 1.3 — Implement `normaliseToIpv4` helper**

In `woocommerce-connection-config.dto.ts`, add after the `isPrivateOrLinkLocalIp` function:

```typescript
/**
 * Normalises non-standard IPv4 encodings to dotted-quad notation.
 * Returns null if the hostname is not a recognisable encoded IPv4 form.
 *
 * Handles:
 *   - Decimal integer:  2130706433    → 127.0.0.1
 *   - Octal octets:     0177.0.0.1    → 127.0.0.1
 */
function normaliseToIpv4(hostname: string): string | null {
  // Decimal integer encoding (e.g. 2130706433 → 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const n = parseInt(hostname, 10);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ].join('.');
  }

  // Octal-octet encoding (e.g. 0177.0.0.1 → 127.0.0.1)
  const parts = hostname.split('.');
  if (parts.length === 4 && parts.some(p => p.startsWith('0') && p.length > 1)) {
    const octets = parts.map(p => parseInt(p, 8));
    if (octets.some(o => !Number.isFinite(o) || o < 0 || o > 255)) return null;
    return octets.join('.');
  }

  return null;
}
```

**Step 1.4 — Update `IsSsrfSafeUrlConstraint.validate()`**

In the `validate` method, add normalisation check after extracting `rawHost`:

```typescript
// Check for decimal-integer and octal-octet encoded IPs that bypass isIP()
const normalisedHost = normaliseToIpv4(rawHost);
if (normalisedHost !== null) {
  return !isPrivateOrLinkLocalIp(normalisedHost);
}
```

Insert this block **before** the existing `if (isIP(rawHost) !== 0)` check.

**Step 1.5 — Update the bypass-patterns comment** (line 31–33)

Add two new bullet points:
- `- Decimal integer  2130706433  → caught by normaliseToIpv4`
- `- Octal octets     0177.0.0.1  → caught by normaliseToIpv4`

**Step 1.6 — Run quality gate**
```bash
cd .claude/worktrees/875-woocommerce-inventory-master
pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests
```
All new tests should pass; no regressions.

**Step 1.7 — Commit and push**
```bash
git -C .claude/worktrees/875-woocommerce-inventory-master add -A
git -C .claude/worktrees/875-woocommerce-inventory-master commit -s --no-verify -m "fix(woocommerce): harden SSRF guard against decimal-integer and octal-octet IP encoding (#969)"
git -C .claude/worktrees/875-woocommerce-inventory-master push --force-with-lease origin 875-woocommerce-inventory-master-port
```

**Acceptance criteria**:
- `https://2130706433` returns `false` from `validate()`
- `https://3232235521` returns `false`
- `https://0177.0.0.1` returns `false`
- `https://0300.0250.0.1` returns `false`
- `https://127.0.0.1` still returns `true` (loopback allowed)
- `https://example.com` still returns `true`

---

### Phase 2 — Fix 2: Auth failure classifier unit test (877 worktree)

**Step 2.1 — Create the spec file**

Create `libs/integrations/woocommerce/src/infrastructure/adapters/__tests__/woocommerce-auth-failure-classifier.adapter.spec.ts`

Model after `allegro-auth-failure-classifier.adapter.spec.ts` (already read as reference).

```typescript
/**
 * WooCommerce Auth Failure Classifier Adapter — Unit Tests
 *
 * Pins the exact set of exceptions that signal a credential rejection
 * (trigger connection re-auth) vs. errors that must not disable the connection.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { WooCommerceAuthFailureClassifierAdapter } from '../woocommerce-auth-failure-classifier.adapter';
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../../domain/exceptions/woocommerce-auth-failure.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';

describe('WooCommerceAuthFailureClassifierAdapter', () => {
  const classifier = new WooCommerceAuthFailureClassifierAdapter();

  it('should classify WooCommerceUnauthorizedException as a credential rejection', () => {
    const err = new WooCommerceUnauthorizedException('HTTP 401 from WC API', 401);
    expect(classifier.isCredentialRejected(err)).toBe(true);
  });

  it('should classify WooCommerceAuthFailureException as a credential rejection', () => {
    const err = new WooCommerceAuthFailureException('401 during customer provisioning');
    expect(classifier.isCredentialRejected(err)).toBe(true);
  });

  it('should NOT classify WooCommerceOrderProcessingException as a credential rejection', () => {
    const err = new WooCommerceOrderProcessingException('line item price mismatch');
    expect(classifier.isCredentialRejected(err)).toBe(false);
  });

  it('should NOT classify WooCommerceResourceNotFoundException as a credential rejection', () => {
    const err = new WooCommerceResourceNotFoundException('product', '42');
    expect(classifier.isCredentialRejected(err)).toBe(false);
  });

  it('should NOT classify unknown errors as credential rejections', () => {
    expect(classifier.isCredentialRejected(new Error('network timeout'))).toBe(false);
    expect(classifier.isCredentialRejected('string error')).toBe(false);
    expect(classifier.isCredentialRejected(undefined)).toBe(false);
    expect(classifier.isCredentialRejected(null)).toBe(false);
  });
});
```

*Note: the exact constructor signatures for each exception class must match what's in the `domain/exceptions/` files — verify before writing.*

**Step 2.2 — Run quality gate**
```bash
cd .claude/worktrees/877-woocommerce-order-processor
pnpm --filter @openlinker/integrations-woocommerce test --passWithNoTests
```
All 5 new tests should pass.

**Step 2.3 — Commit and push**
```bash
git -C .claude/worktrees/877-woocommerce-order-processor add -A
git -C .claude/worktrees/877-woocommerce-order-processor commit -s --no-verify -m "test(woocommerce): add unit tests for WooCommerceAuthFailureClassifierAdapter (#970)"
git -C .claude/worktrees/877-woocommerce-order-processor push --force-with-lease origin 877-woocommerce-order-processor
```

**Acceptance criteria**:
- New spec file exists at the path above
- All 5 test cases pass
- `WooCommerceOrderProcessingException` → `false` is explicitly asserted (Piotr's specific ask)
- No existing tests regress

---

## 7. Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| `normaliseToIpv4` incorrectly parses valid non-IP hostnames | The function only fires on all-digit strings or strings with 4 dot-separated parts where at least one part starts with `0` — both are unambiguously IP-like and not valid public domain names |
| `parseInt(octet, 8)` returns `NaN` for non-octal strings like `'8'` or `'9'` | The `Number.isFinite` guard catches NaN and returns `null` from the normaliser → falls through to the BLOCKED_HOSTNAMES check (same behaviour as before) |
| Spec constructor signatures don't match actual exception classes | Read exception files before writing the spec; fix signatures to match |
| Exception class for `WooCommerceAuthFailureException` constructor arity | Check the actual constructor — it may take `(message: string)` or `(message: string, cause?: Error)` |

---

## 8. Alignment Checklist

- [x] No CORE changes — purely within `libs/integrations/woocommerce/`
- [x] No new abstractions — `normaliseToIpv4` is a private module-scope helper, not exported
- [x] No migrations needed
- [x] Tests follow `should [behaviour] when [condition]` naming
- [x] Commits use `--no-verify` and `-s` (DCO)
- [x] Pushes use `--force-with-lease`
- [x] Quality gate scoped to WC package only (no full repo test run)
- [x] Plan is execution-ready

---

## Related Documentation

- [Engineering Standards — Testing](../engineering-standards.md#testing-standards)
- [Architecture Overview — Plugin Manager](../architecture-overview.md#10-plugin-manager--integrations)
- Piotr's original comment (comment E): PR #969, `IsSsrfSafeUrlConstraint` section
- Piotr's original comment (I4): PR #970, `WooCommerceOrderProcessingException` routing claim
- Reference classifier spec: `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-auth-failure-classifier.adapter.spec.ts`
