# Implementation Plan — #406 Skip Allegro `impliedWarrantyId` when no `warrantyId` is set

## 1. Understand

**Goal.** After PR #401 unblocked the image-upload step, `marketplace.offer.create` against Allegro sandbox now fails one step further with `ImpliedWarrantyNotDefinedException` (HTTP 422) when the seller account has no Complaints Terms (Warunki reklamacji) configured. The wizard auto-populates `impliedWarrantyId` from `fetchSellerPolicies()` and the adapter forwards it unconditionally. Operators with a fully-set-up account silently lose nothing; operators without Complaints Terms hit a hard 422 with no actionable signal in the OL UI.

**Solution shape (Solution A from the issue).** Treat `impliedWarrantyId` as gated by `warrantyId`: only include `body.afterSalesServices.impliedWarranty` in the create-offer payload when **both** `warrantyId` **and** `impliedWarrantyId` are non-empty strings on `platformParams`. The reasoning: an operator who isn't claiming a manufacturer's warranty is signalling they don't want any after-sales overrides; in practice, accounts that lack Complaints Terms also lack Warranty Terms, so the coupling is correct in the cases that matter.

**Layer.** Integration (Allegro adapter) + Frontend (wizard hint). No CORE / domain changes.

**Non-goals.**
- Solution B (Complaints Terms preflight) — separate issue if needed.
- Solution C (translate the Allegro error message) — separate issue (could layer on top later).
- Restructuring the wizard to hide impliedWarranty entirely when no implied warranties are returned.
- Any changes to seller-policies fetching, OAuth, or category parameters.

## 2. Research

### Adapter site (`libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:809-827`)

Current code in `applyPlatformParams`:

```ts
const returnPolicyId = platformParams['returnPolicyId'];
const warrantyId = platformParams['warrantyId'];
const impliedWarrantyId = platformParams['impliedWarrantyId'];
if (
  typeof returnPolicyId === 'string' ||
  typeof warrantyId === 'string' ||
  typeof impliedWarrantyId === 'string'
) {
  body.afterSalesServices = {};
  if (typeof returnPolicyId === 'string') {
    body.afterSalesServices.returnPolicy = { id: returnPolicyId };
  }
  if (typeof warrantyId === 'string') {
    body.afterSalesServices.warranty = { id: warrantyId };
  }
  if (typeof impliedWarrantyId === 'string') {
    body.afterSalesServices.impliedWarranty = { id: impliedWarrantyId };
  }
}
```

Three siblings — `returnPolicy`, `warranty`, `impliedWarranty` — independently included today. The change introduces a coupling between `warranty` and `impliedWarranty` (only this pair, not `returnPolicy`).

### Existing test coverage (`libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts:715-750`)

Single happy-path spec, "maps platformParams to delivery/return/warranty/invoice/parameters", sends both `warrantyId` and `impliedWarrantyId` → asserts both present in the body. Stays green after the fix because the gating predicate is satisfied (both present).

No existing spec covers the "implied without warranty" branch — it's the bug. Need a new spec.

### Wizard site (`apps/web/src/features/listings/components/CreateOfferWizard.tsx:617-637`)

```tsx
<FormField label="Warranty (optional)" name="warrantyId">
  <Select {...form.register('warrantyId')}>
    <option value="">No override</option>
    {(policies?.warranties ?? []).map((p) => (
      <option key={p.id} value={p.id}>{p.name}</option>
    ))}
  </Select>
</FormField>

<FormField label="Implied warranty (optional)" name="impliedWarrantyId">
  <Select {...form.register('impliedWarrantyId')}>
    <option value="">No override</option>
    {(policies?.impliedWarranties ?? []).map((p) => (
      <option key={p.id} value={p.id}>{p.name}</option>
    ))}
  </Select>
</FormField>
```

`FormField` already accepts a `description?: ReactNode` prop (`apps/web/src/shared/ui/form-field.tsx:23`) and wires it through `aria-describedby`. The hint goes there — no new primitive, no new CSS.

### Submit-time mapping (`CreateOfferWizard.tsx:250-251`)

```tsx
if (values.warrantyId) platformParams.warrantyId = values.warrantyId;
if (values.impliedWarrantyId) platformParams.impliedWarrantyId = values.impliedWarrantyId;
```

Stays as-is. The wizard happily forwards both; the adapter gate is the one place that enforces the coupling. This keeps the FE → BE contract narrow (FE just maps form state to platform params; the integration knows what's safe to send).

## 3. Design

**Adapter change (the actual fix).** Move `impliedWarranty` inside the `warrantyId` branch — this makes the coupling structurally visible and avoids a TypeScript narrowing trap (a `boolean` const like `sendImpliedWarranty` would not narrow `impliedWarrantyId` from `unknown` to `string` inside its `if`):

```ts
const returnPolicyId = platformParams['returnPolicyId'];
const warrantyId = platformParams['warrantyId'];
const impliedWarrantyId = platformParams['impliedWarrantyId'];

// Allegro requires Complaints Terms (Warunki reklamacji) at the seller-account
// level before any impliedWarrantyId can be referenced. Treat impliedWarranty
// as gated by warranty: if the operator didn't pick a regular warranty, skip
// implied so we don't trigger ImpliedWarrantyNotDefinedException (#406).
const sendImpliedWarranty =
  typeof impliedWarrantyId === 'string' && typeof warrantyId === 'string';

if (
  typeof returnPolicyId === 'string' ||
  typeof warrantyId === 'string' ||
  sendImpliedWarranty
) {
  body.afterSalesServices = {};
  if (typeof returnPolicyId === 'string') {
    body.afterSalesServices.returnPolicy = { id: returnPolicyId };
  }
  if (typeof warrantyId === 'string') {
    body.afterSalesServices.warranty = { id: warrantyId };
    if (typeof impliedWarrantyId === 'string') {
      body.afterSalesServices.impliedWarranty = { id: impliedWarrantyId };
    }
  }
}
```

Three notes on shape:
1. `impliedWarranty` is written inside the `warrantyId` branch — TypeScript narrows `impliedWarrantyId` to `string` from the inline `typeof` check, and the coupling reads top-to-bottom without needing a separate `sendImpliedWarranty` re-check inside.
2. The outer `if` predicate keeps `sendImpliedWarranty` so we still skip allocating `body.afterSalesServices` when only `impliedWarrantyId` is set with no `warrantyId` or `returnPolicyId` — strictly correct: there's nothing to send.
3. The header comment explains *why* this coupling exists; without it a future contributor would otherwise re-introduce the unconditional write.

**Wizard hint (operator clarity).** Add `description` to the impliedWarranty `FormField`. Mention Allegro by name (matches surrounding fields like "Allegro category") and use "dropped from the request" instead of "ignored" so the operator knows the silent behaviour:

```tsx
<FormField
  label="Implied warranty (optional)"
  name="impliedWarrantyId"
  description="Allegro requires a Warranty selection alongside Implied warranty; otherwise the value is dropped from the request."
>
```

Single line, no logic, no conditional rendering. Operators see the rule before submitting; if they ignore it, the adapter still drops the field safely.

**Why not also disable the select when `warrantyId` is empty?** The issue's AC explicitly asks for a "small inline hint" — disabling adds form-state coupling, requires re-enabling on warranty change, and doesn't help an operator who plans to set warranty later in the wizard (the fields are on the same step). Hint is enough.

## 4. Implementation Steps

### Step 1 — Adapter fix

**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`
**Lines:** 809–827

Replace the existing block with the coupled-predicate version above. Add a one-line comment explaining the Allegro account-level constraint.

Acceptance:
- `body.afterSalesServices.impliedWarranty` is only set when both `warrantyId` and `impliedWarrantyId` are non-empty strings.
- `body.afterSalesServices` is omitted entirely when none of `returnPolicyId`, `warrantyId`, or the coupled-impliedWarranty predicate apply (covers the "impliedWarrantyId alone" case).
- `returnPolicyId` and `warrantyId` behavior unchanged on every other branch.

### Step 2 — Adapter test coverage

**File:** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`

Add **two** new specs, colocated with the existing `maps platformParams to delivery/return/warranty/invoice/parameters` happy-path test:

1. `it('omits impliedWarranty when impliedWarrantyId is set but warrantyId is not')` — `platformParams = { impliedWarrantyId: 'iwar-1' }` → `body.afterSalesServices` is undefined OR (if other fields engage) the block is present without an `impliedWarranty` key.
2. `it('omits impliedWarranty when impliedWarrantyId is set with returnPolicy but no warranty')` — `platformParams = { returnPolicyId: 'ret-1', impliedWarrantyId: 'iwar-1' }` → `body.afterSalesServices = { returnPolicy: { id: 'ret-1' } }` (no impliedWarranty key).

The existing happy-path spec (both ids → both present) stays as the positive coverage for the "both ids → impliedWarranty included" AC bullet.

Acceptance:
- New specs pass against the patched adapter and fail against the pre-patch adapter.
- Existing 35-spec suite stays green.

### Step 3 — FE wizard hint

**File:** `apps/web/src/features/listings/components/CreateOfferWizard.tsx`
**Line:** 628

Add a `description` prop to the `impliedWarrantyId` `FormField`:

```tsx
description="Requires a Warranty selection above; otherwise the value is ignored."
```

Acceptance:
- The hint renders below the Implied warranty select.
- `FormField` already wires `aria-describedby` automatically — no extra a11y work.
- No CSS changes (`form-field__description` already styled in `index.css`).

### Step 4 — FE test coverage

**File:** `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx` (file already exists, contains the wizard test suite).

Add one assertion to whichever existing spec walks the wizard to step 2 (Policies). The hint substring "Allegro requires a Warranty selection" must be present in the rendered output once policies have loaded. Visibility regression guard — cheap and high-signal.

Acceptance:
- New assertion passes; no other spec affected.

### Step 5 — Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

Acceptance: all green, no new warnings introduced.

### Step 6 — Commit

Conventional commit:
```
fix(allegro): skip impliedWarranty on offer-create when warrantyId is unset

Allegro rejects offer-create with ImpliedWarrantyNotDefinedException (422)
when the seller account has no Complaints Terms (Warunki reklamacji)
configured but the request includes an impliedWarrantyId. The wizard
auto-populates impliedWarrantyId from fetchSellerPolicies() so operators
who never explicitly chose one still hit the 422.

Treat impliedWarranty as gated by warranty: only forward
impliedWarrantyId to the create-offer payload when warrantyId is also a
non-empty string. Operators with both account-level policies set up
continue to send both fields and see no behavior change. Operators
without warranty (most accounts that also lack Complaints Terms) get a
clean offer-create without the 422.

Add an inline hint on the wizard's Implied warranty field so the rule is
discoverable before submit.

Closes #406
```

(Standard `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer.)

### Step 7 — Push and PR

Push `406-allegro-skip-implied-warranty` to origin, open PR with `Closes #406` in body, summary mirrors the commit message + reproduction steps from the issue.

## 5. Validate

**Architecture.** Adapter-internal change. No port surface modified, no new capability, no CORE involvement. The coupling rule lives in the integration layer where it belongs (it's an Allegro-specific account-level constraint, not a domain rule about offers in general).

**Naming / standards.** No new files, no new identifiers. Existing conventions preserved.

**Testing strategy.** Two new unit specs around the coupling predicate; one FE assertion for the hint. Per `engineering-standards.md` § Testing Standards, integration adapter coverage target is 70% — these two specs lift coverage on the gating path that didn't exist before. Integration tests not warranted (no DB, no Nest wiring change; the adapter unit suite is the right level).

**Security.** None.

**Risks.**
- *Operator who has Complaints Terms set up but didn't pick `warrantyId` silently loses the impliedWarranty they selected.* Mitigated by the wizard hint. Acknowledged in the issue as the explicit trade-off of Solution A.
- *Future Allegro change makes impliedWarranty independent of warranty.* The coupling sits in one place with a comment explaining why; trivial to revisit when (if) that changes.

**Open questions.** None.
