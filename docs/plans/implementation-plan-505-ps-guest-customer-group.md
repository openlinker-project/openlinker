# Implementation Plan — #505 PrestaShop guest customer default group

## Goal

OL-provisioned guest customers must land in a non-zero PS group so `POST /orders` doesn't silently zero the order's `id_carrier` at the group-validation layer. Closes the residual half of the carrier-mapping bug — #503/PR #504 fixed the cart side; this fix unblocks the order side.

## Layer classification

Integration (PrestaShop) — Infrastructure layer only. Touches:
- one config-type interface
- one provisioner-input type interface
- one provisioner method body
- one new test spec

No CORE changes. No schema migration. No FE work (Tier 2 UI deferred per the issue).

## Step-by-step

### Step 1 — extend `PrestashopConnectionConfig`

**File:** `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`

Add `guestCustomerGroupId?: number` field with JSDoc that covers:
- Optional. Defaults to 2 (PS stock-fixture "Guest" group).
- Must be a positive integer. `0`, negatives, and non-finite values are rejected at provisioning time with a `warn` log and fall back to 2.
- Why this exists: PS WS validates the order's `id_carrier` against the customer's groups; carriers with group restrictions reject any group-0 customer. PS's stock fixture puts guests in group 2; non-stock shops can override.
- Mirrors the resolution-chain pattern used by `defaultCarrierId` (lines 92-105) for consistency.

**Acceptance:** Type compiles. No consumer breakage. The field is purely additive.

### Step 2 — extend `PrestashopCustomerCreate`

**File:** `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-provisioner.types.ts`

Add two optional fields to the existing interface:
- `id_default_group?: number`
- `associations?: { groups?: { group?: Array<{ id: number }> } }` (PS WS XML-association shape — array of group refs)

The interface already has a `[key: string]: unknown` index signature, so technically these would compile without explicit declaration — but explicit declarations carry intent and prevent silent typos at call sites.

**Acceptance:** Type compiles.

### Step 3 — update `resolveOrCreateGuestCustomer`

**File:** `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-customer-provisioner.ts:248`

Build the `groupId` immediately before the `customerData` object:

```ts
const PS_GUEST_GROUP_DEFAULT = 2;

const configuredGroupId = connectionConfig.guestCustomerGroupId;
let groupId = PS_GUEST_GROUP_DEFAULT;
if (configuredGroupId !== undefined) {
  if (Number.isFinite(configuredGroupId) && configuredGroupId > 0) {
    groupId = configuredGroupId;
  } else {
    this.logger.warn(
      `Connection config has invalid guestCustomerGroupId=${String(configuredGroupId)} ` +
        `(must be a positive integer) for connection ${destinationConnectionId} — ` +
        `falling back to PS default Guest group (id=${PS_GUEST_GROUP_DEFAULT}).`,
    );
  }
}
```

Then extend the existing `customerData`:

```ts
const customerData: PrestashopCustomerCreate = {
  is_guest: 1,
  passwd: generatePassword(),
  firstname: firstName || 'Guest',
  lastname: lastName || 'Customer',
  email: normalizedEmail,
  active: 1,
  id_default_group: groupId,
  associations: {
    groups: { group: [{ id: groupId }] },
  },
};
```

The `associations.groups.group` double-nested shape matches the established PS WS JSON body convention used elsewhere in the codebase (verified: `prestashop-order.mapper.ts:277` uses `associations: { order_rows: { order_row: [...] } }` — same collection-then-singular nesting). Setting only `id_default_group` is insufficient because PS uses the `customer_group` join table for group membership and it's populated from the `associations` block at create time.

**Acceptance:** The customer-create body sent to PS includes both fields. Defensive normalization fires on bad config.

### Step 4 — new test file

**File:** `libs/integrations/prestashop/src/infrastructure/provisioners/__tests__/prestashop-customer-provisioner.spec.ts` (new)

The adapter spec mocks `PrestashopCustomerProvisioner` directly, so there's no existing suite that exercises `resolveOrCreateGuestCustomer`'s body shape. Three focused unit tests are enough:

1. **Default path** — `connectionConfig.guestCustomerGroupId` unset → asserts the captured body via `expect.objectContaining({ is_guest: 1, active: 1, id_default_group: 2, associations: { groups: { group: [{ id: 2 }] } } })`. Use `objectContaining` (not exact `toEqual`) so the test stays robust when unrelated fields are added later, but include all 4 of the load-bearing fields so a future refactor that drops `is_guest` (or renames `associations.groups.group`) trips the test.
2. **Override path** — `connectionConfig.guestCustomerGroupId === 5` → both `id_default_group` and the inner `group[0].id` use 5; same `objectContaining` assertion shape.
3. **Defensive path** — `connectionConfig.guestCustomerGroupId === 0` → body falls back to `id_default_group: 2` and `group: [{ id: 2 }]`; spy asserts `logger.warn` fires with a message matching `/invalid guestCustomerGroupId=0.*falling back/i`.

Each test mocks:
- `IPrestashopWebserviceClient` — `listResources` returns `[]` (no email match), `createResource` returns `{ id: 'X' }`
- `IdentifierMappingPort` — `getExternalIds` returns `[]` (no existing mapping), `getOrCreateExactMapping` returns the new external id

Capture the body via `createResource.mock.calls[0][1]` and assert against it.

**Acceptance:** Three new tests pass. The full PS package suite stays green (currently 229).

## Risks

- **Operators with non-stock PS group setups** (no group 2 or group 2 used unconventionally) get the wrong default. Mitigation: the connection-config override is documented in the field's JSDoc; a misconfigured shop sees the same downstream symptom (carrier rejected) and the resolution path is one connection-config edit away.
- **Backfill is out of scope.** Already-synced test orders stay at `id_carrier=0`. A one-shot `UPDATE ps_customer SET id_default_group=2 WHERE is_guest=1 AND id_default_group=0` would unstick them, but it's outside the regression-test surface.
- **No integration test.** Per the testing-guide, the carrier-mapping vertical slice is a known gap. This PR doesn't add one; the manual-verification gate stays the load-bearing assertion until a Testcontainers PS harness exists. Tracked separately in **#506**.

## Implementation order

1. Add types (Steps 1 + 2) — no behavior change, no test breakage
2. Wire the provisioner (Step 3) — full PS suite stays green because no existing spec exercises this code path
3. Add the new spec (Step 4) — locks down both happy and defensive paths
4. Run the quality gate (lint / type-check / test)
5. Self-review per `docs/code-review-guide.md` and apply any pre-flight polish
6. Manual verification: re-sync one fresh Allegro order against the dev install, confirm `ps_orders.id_carrier > 0`, `total_shipping == 10.95`, `total_paid == total_paid_real`

## Out of scope

- Tier 2 UI for group mapping (separate "nice-to-have" if asked)
- Group assignment for registered (non-guest) customers — none today via OL
- VAT split on `shipping_cost_tax_excl/incl` — orthogonal accounting concern
- Backfill of stuck test orders
