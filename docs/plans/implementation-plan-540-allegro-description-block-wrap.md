# Implementation Plan — #540 Allegro offer-create 422 on plain-text descriptions

**Branch:** `540-allegro-description-block-wrap`
**Closes:** #540

---

## 1. Understand the task

**Goal.** When `sanitizeAllegroDescription` produces output that contains no block-level tag (plain text, inline-only `<b>` etc.), wrap it in `<p>…</p>` so Allegro's TEXT validator accepts it. Today's behaviour ships bare text, which Allegro rejects with `VALIDATION_ERROR / "Nieprawidłowy podzbiór HTML"`.

**Layer.** Integration — `libs/integrations/allegro/src/infrastructure/util/`. Pure-function util; no domain or port changes.

**Explicit non-goals** (per issue):
- Splitting plain text on `\n\n` into multiple `<p>` blocks.
- Replacing the regex sanitizer with a real allowlist parser (`sanitize-html`) — already documented as a future upgrade path in the file header.
- Retry-on-422 with a wrapped body.

---

## 2. Research summary

- `sanitize-allegro-description.ts:42-55` runs a single regex tag-strip pass (whitelisted: `p, br, h1, h2, ul, ol, li, b, strong, i, em, u`) followed by `capByteLength(40000)`. No block-wrap step today.
- Two call sites — both feed the result into `description.sections[0].items[0].content`:
  - `allegro-offer-manager.adapter.ts:905` (`updateOfferFields` description path)
  - `allegro-offer-manager.adapter.ts:1249` (`createOffer` overrides path; result is `.trim()`-ed and `length>0`-gated, so empty stays empty)
- Both call sites accept any string Allegro will accept — the wrap is fully transparent to callers.
- 11 existing unit tests in `__tests__/sanitize-allegro-description.spec.ts`. Three encode the current (buggy) un-wrapped behaviour and need updating. The rest are unaffected (their inputs already start with a block tag, or are empty).
- Allegro's accepted block-tag set per the issue: `<p>`, `<h1>`, `<h2>`, `<ul>`, `<ol>`. `<br>` and `<li>` are inline / structural-children and don't satisfy the validator alone.

---

## 3. Design

### 3.1 Wrap predicate

Add a private predicate `needsBlockWrapping(html)`:

1. `trim()` — empty → `false` (we never emit `<p></p>` for whitespace-only).
2. Test against `BLOCK_TAG_OPENER_PATTERN = /<(p|h1|h2|ul|ol)\b/i` — a match means the content already opens with one of Allegro's accepted block-level tags somewhere → `false`.
3. Otherwise → `true`.

### 3.2 Wrap placement vs. byte cap

The byte cap (40000 bytes) must hold even after wrap. Reserve the wrapper overhead up front, derived from the actual wrapper bytes (no hardcoded `7`) so a future tag change can't silently break the budget:

```ts
const WRAPPER_PREFIX = '<p>';
const WRAPPER_SUFFIX = '</p>';
const WRAPPER_OVERHEAD = Buffer.byteLength(WRAPPER_PREFIX + WRAPPER_SUFFIX, 'utf8');

const stripped = html.replace(TAG_PATTERN, …);
if (stripped.trim().length === 0) return ''; // contract: empty/whitespace-only → empty
const wrap = needsBlockWrapping(stripped);
const capped = capByteLength(stripped, wrap ? MAX_BYTES - WRAPPER_OVERHEAD : MAX_BYTES);
return wrap ? `${WRAPPER_PREFIX}${capped}${WRAPPER_SUFFIX}` : capped;
```

The early-return on whitespace-only input is the new sanitizer contract: empty stays empty (existing test case) AND whitespace-only collapses to empty. This is symmetric and prevents `updateOfferFields` (which has no `.trim().length > 0` gate at the call site) from shipping bare whitespace to Allegro and 422-ing.

### 3.3 What changes in observable behaviour

| Input | Before | After |
|---|---|---|
| `'plain text'` | `'plain text'` (rejected by Allegro) | `'<p>plain text</p>'` |
| `'<b>bold</b>'` | `'<b>bold</b>'` (rejected) | `'<p><b>bold</b></p>'` |
| `'<p>already</p>'` | `'<p>already</p>'` | `'<p>already</p>'` (unchanged) |
| `'<h1>title</h1>'` | unchanged | unchanged |
| `'   \n  '` | `'   \n  '` (rejected by Allegro on `updateOfferFields`) | `''` (sanitizer-level contract — see §3.2) |
| `''` | `''` | `''` |

---

## 4. Step-by-step

### S1 — Update the sanitizer
**File:** `libs/integrations/allegro/src/infrastructure/util/sanitize-allegro-description.ts`
**Changes:**
- Add `BLOCK_TAG_OPENER_PATTERN` constant.
- Add `WRAPPER_PREFIX` / `WRAPPER_SUFFIX` constants and a derived `WRAPPER_OVERHEAD`.
- Add private `needsBlockWrapping` helper.
- Modify `sanitizeAllegroDescription` to (a) early-return `''` on empty/whitespace-only stripped output, (b) wrap when the predicate fires, (c) reserve `WRAPPER_OVERHEAD` bytes in the cap.
- Extend the file-header JSDoc to mention the block-wrap step + the empty/whitespace contract + cite the issue.

### S2 — Update + extend the unit spec
**File:** `libs/integrations/allegro/src/infrastructure/util/__tests__/sanitize-allegro-description.spec.ts`

**Update existing tests** (encoded buggy behaviour):
- `'drops disallowed tags but preserves inner text'` → expect `<p>plain text</p>`.
- `'normalizes self-closing br variants to <br>'` → expect `<p>a<br>b<br>c<br>d</p>` (input has no block tag).
- Rename `'passes plain text through unchanged'` → `'wraps plain text in <p>…</p>'` and assert `<p>just text, no tags</p>`.

**Add new regression tests:**
- "wraps inline-only output in `<p>`" — `<b>bold</b>` → `<p><b>bold</b></p>`.
- "doesn't double-wrap content that already starts with `<p>`".
- "doesn't double-wrap content that starts with `<h1>` / `<ul>` / `<ol>`" (parametrised).
- "collapses whitespace-only input to empty (contract symmetry with empty input)".
- "wraps the #540 seed fixture (Bosch GSR plain-text description)" — output starts with `<p>`, ends with `</p>`, contains the original first sentence.
- "honours the byte cap when wrapping multi-byte plain text" — `'ą'.repeat(25000)` → output ≤ 40000 bytes AND starts with `<p>` AND ends with `</p>`.
- "honours the exact byte budget when wrap fires at the cap" — input sized so the wrapped output is exactly `MAX_BYTES` bytes; locks the budget arithmetic against future drift.

### S2.5 — Verify no adapter spec encodes the old un-wrapped sanitizer output

Grep `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` for assertions on `description.sections[0].items[0].content` shape. If any test passes plain text in and asserts plain text out, update the expectation to the wrapped form. Same lesson as #506 — tests that encode buggy behaviour will silently fail green until they're hit. Cheap pre-check; expensive post-merge.

### S3 — Quality gate
- `pnpm --filter @openlinker/integrations-allegro test -- sanitize-allegro-description` — focused run while iterating.
- `pnpm lint && pnpm type-check && pnpm test` — full pre-commit pass.

### S4 — Commit + PR
Conventional commit (`fix(allegro): …`); PR body includes `Closes #540`.

---

## 5. Validation

- **Architecture compliance.** Pure util in `infrastructure/util/`. No CORE / Integration boundary crossed. No port-contract changes.
- **Naming.** File and exports unchanged. New constant + helper kept private.
- **Testing strategy.** Extending the existing co-located unit spec — no new files. Behaviour-level coverage for the three failure modes the issue calls out (plain text, inline-only, whitespace-only) plus existing-block no-op cases.
- **Security.** Doesn't change the input surface. The `sanitize-html`-upgrade comment in the file header stays relevant verbatim.
- **Risks:**
  - **R1 — Tests asserting raw output.** Three existing tests encode the un-wrapped output. Updated explicitly per S2.
  - **R2 — Adapter call sites.** Both call sites already shape the result into `content: …` and don't inspect its HTML structure. Verified by reading `allegro-offer-manager.adapter.ts:895-909` and `:1248-1258`.
  - **R3 — Byte cap ↔ wrap interaction.** Reserved 7 bytes for `<p></p>` overhead so `Buffer.byteLength(output) ≤ 40000` invariant always holds, even when wrap fires after a near-cap input.
  - **R4 — `<br>`-only inputs.** `<br>` is inline; an input of just `<br>` becomes `<p><br></p>`. Acceptable — Allegro accepts that shape; alternative (no-wrap) would 422.
- **Out of scope (recap):** paragraphisation on `\n\n`, `sanitize-html` rewrite, 422 retry path.
