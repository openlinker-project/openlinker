# Implementation plan — #885 shipping adapters throw typed `ShippingProviderRejectionException`

## 1. Understand the task

**Goal.** Close the loop on PR #881's controller split. PR #881 added
`ShippingProviderRejectionException` (BE) and updated
`ShipmentController.toHttpException` to map the typed exception to `502` while
falling through any untyped `Error` to `500` (logged with stack). Adapters
today throw plugin-specific typed exceptions (`InpostValidationException`,
`PaczkomatUnavailableException`, `AllegroShipmentRejectedException`) that
**don't** inherit from `ShippingProviderRejectionException`, so real carrier-
rejection cases mis-attribute to 500 instead of 502 at the HTTP boundary.

**Layer.** Pure backend — domain exceptions + integration adapters + their
spec files. No FE work, no migrations, no new ports, no orchestration
changes.

**Classification.**

| Aspect | Value |
|---|---|
| Type | Refactor (intentionally **breaking change** at the plugin contract surface — see §3.0) |
| Bounded contexts touched | `shipping` (core), `inpost` (plugin), `allegro` (plugin) |
| New tests | One base-exception spec (closed-core contract) + spec updates that swap leaf-`instanceof` for discriminator-field assertions |
| Migration | None |
| Effort | S (≤1 day) |

**Explicit non-goals (per the issue body).**

- Don't add `retryable: boolean` to the exception.
- Don't wire a retry policy keyed on `providerCode`.
- Don't build a per-provider error-code taxonomy in core; the providerCode
  carries the carrier's code verbatim from the adapter.
- Don't migrate `AllegroApiException`, `AllegroAuthenticationException`,
  `AllegroRateLimitException`, `AllegroNetworkException`,
  `InpostNetworkException`, `InpostUnauthorizedException`,
  `InpostConfigException` — these are transport / auth / config failures, not
  provider rejections. The controller correctly 500s these.
- Don't tighten `AllegroDeliveryShippingAdapter.toRejected` to gate on `4xx`
  status. That widening shipped in #833 and is out of scope.
- Don't change the int-spec surface.

## 2. Research — what the codebase already has

### 2.1 The seam introduced by PR #881

`libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts`:

```ts
export class ShippingProviderRejectionException extends Error {
  constructor(
    public readonly providerName: string,
    public readonly providerCode: string | null,
    message: string,
  ) {
    super(`Shipping provider ${providerName} rejected the command: ${message}`);
    this.name = 'ShippingProviderRejectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

`apps/api/src/shipping/http/shipment.controller.ts:255` — dispatch result:

```ts
if (error instanceof ShippingProviderRejectionException) {
  return new BadGatewayException(error.message);
}
if (error instanceof Error) {
  this.logger.error(`Unclassified shipping-command error: ${error.message}`, error.stack);
  return new InternalServerErrorException(error.message);
}
```

### 2.2 Existing plugin-side typed exceptions and their roles

| File | Role | Migration |
|---|---|---|
| `libs/integrations/inpost/src/domain/exceptions/inpost-validation.exception.ts` | ShipX 4xx + adapter pre-flight (mapper) + paczkomat unavailable upstream | **DELETE** — throw sites move to the base class with `providerName='inpost'` |
| `libs/integrations/inpost/src/domain/exceptions/paczkomat-unavailable.exception.ts` | Adapter re-tag of an InPost validation error when `target_point` is the cause | **DELETE** — throw site moves to base class with `providerCode='target_point'` + `providerDetails: { paczkomatId }` |
| `libs/integrations/allegro/src/domain/exceptions/allegro-shipment-rejected.exception.ts` | Allegro create/cancel rejection (wrapped `AllegroApiException` + ERROR-state command result + adapter pre-flight from mapper) | **DELETE** — throw sites move to base class with `providerName='allegro'` + `providerCode=<first error code>` + `providerDetails: { errors }` |
| `libs/integrations/inpost/src/domain/exceptions/inpost-unauthorized.exception.ts` | 401/403 auth | Untouched (not a rejection; correctly 500s today) |
| `libs/integrations/inpost/src/domain/exceptions/inpost-network.exception.ts` | Transport / unparseable body | Untouched |
| `libs/integrations/inpost/src/domain/exceptions/inpost-config.exception.ts` | Adapter config pre-check | Untouched |
| `libs/integrations/allegro/src/domain/exceptions/allegro-shipment-pending.exception.ts` | Poll budget exhausted (retriable) | Untouched (not a rejection) |
| `libs/integrations/allegro/src/domain/exceptions/allegro-api.exception.ts` | Generic HTTP failure (incl. 5xx) | Untouched as a class. Adapter wraps it for create/cancel into the new base; `getTracking` propagates it raw. |
| `libs/integrations/allegro/src/domain/exceptions/allegro-{authentication,rate-limit,network}.exception.ts` | Auth / rate / transport | Untouched |

### 2.3 All throw + consumer sites (the full migration scope)

Across both plugins, every reference to the three leaf exceptions:

| File | Use | Migration |
|---|---|---|
| `libs/integrations/inpost/src/index.ts:15-16` | Barrel export of `InpostValidationException` + `PaczkomatUnavailableException` | DELETE these two lines (**breaking**: removes public surface) |
| `libs/integrations/allegro/src/index.ts:53` | Barrel export of `AllegroShipmentRejectedException` | DELETE this line (**breaking**: removes public surface) |
| `libs/integrations/inpost/src/infrastructure/http/inpost-http-client.ts:149` | Throws `InpostValidationException(message, details)` on ShipX 4xx | Swap to `new ShippingProviderRejectionException('inpost', firstDetailKey(details), message, { fieldErrors: details })` |
| `libs/integrations/inpost/src/infrastructure/http/inpost-http-client.interface.ts:28` | JSDoc comment name-drops the leaf class | Update JSDoc to reference `ShippingProviderRejectionException` |
| `libs/integrations/inpost/src/infrastructure/mappers/inpost-shipx.mapper.ts:111, 165, 168, 184, 188` | Adapter pre-flight gates throw `InpostValidationException` | Swap to `new ShippingProviderRejectionException('inpost', <pre-flight code>, message)` — see §3.2 for the code values |
| `libs/integrations/inpost/src/infrastructure/adapters/inpost-shipping.adapter.ts:70-77` | Re-tags `InpostValidationException` → `PaczkomatUnavailableException` when `target_point` is the cause | Re-tag the base class: `instanceof ShippingProviderRejectionException` + `providerName === 'inpost'` + `mentionsTargetPoint`. Re-throw a fresh base instance with `providerCode='target_point'` + `providerDetails: { paczkomatId, fieldErrors }`. |
| `libs/integrations/inpost/src/testing/fake-inpost-shipping.adapter.ts:27, 54, 59` | Fake throws `InpostValidationException` for pre-flight gaps | Swap to base class throws (same pattern as the real mapper) |
| `libs/integrations/inpost/src/domain/exceptions/inpost-config.exception.ts:6` | JSDoc name-drop | Update JSDoc |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts:85, 111, 181, 203` | 4 throws of `AllegroShipmentRejectedException` (unsupported method, missing shipmentId after success, ERROR-state command, wrapped `AllegroApiException`) | Swap all 4 to base class throws. ERROR-state case carries `providerCode = first errors[].code`, others `providerCode = null` or a stable string per case (see §3.2). |
| `libs/integrations/allegro/src/infrastructure/mappers/allegro-shipment.mapper.ts:88, 96` | Mapper pre-flight throws (missing deliveryMethodId, missing parcel dims) | Swap to base class throws with stable codes |
| All consumer specs (8 files, listed in §4) | Assert `instanceof <leaf>` | Replace with discriminator-field assertions: `expect(error).toBeInstanceOf(ShippingProviderRejectionException)` + `expect(error.providerName).toBe('inpost')` + `expect(error.providerCode).toBe('target_point')` |

### 2.4 The closed-core / open-runtime precedent we're aligning to

This migration matches the pattern already shipped in:

- `KnownCarrierValues` / `Shipment.carrier: string | null` (#769, just shipped) — closed type for FE convenience, open string at the registry boundary.
- `CoreCapabilityValues` / `AdapterMetadata.supportedCapabilities: (CoreCapability | string)[]` (#576) — same shape.
- `PromptTemplateChannel = string` (#580) — fully open string.

The exception migration is the same architectural move:

- **Closed core**: one typed-rejection class lives in `libs/core/src/shipping/domain/exceptions/`.
- **Open runtime**: plugins discriminate via `providerName` (free string) + `providerCode` (free string) + `providerDetails` (open-shape payload). No per-plugin subclass; no plugin-side rejection-exception files needed for new integrations.

## 3. Design

### 3.0 Why a breaking change is the right call

This is the first cycle since #881 to operate on the rejection seam — no
downstream consumers depend on the leaf-exception names yet (verified by
grep: zero references in `apps/*` or `libs/core` to
`InpostValidationException` / `PaczkomatUnavailableException` /
`AllegroShipmentRejectedException`; the barrel exports are unread). Acting
now keeps the plugin contract surface minimal before consumers calcify
against it. Acting later means deprecating the leaf classes, which is a
larger surface to walk back.

The change is breaking at the **API surface** (plugin barrel exports drop
three names) but not at the **behavioural surface** (controller still 502s
the same rejections; logs still carry the same operator-readable messages).

### 3.1 The refactored base class

```ts
// libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts

/**
 * Single typed rejection seam every shipping adapter throws across when a
 * carrier API rejects a command or an adapter pre-flight check fails on
 * provider-defined constraints. The HTTP controller maps this to 502 Bad
 * Gateway; untyped Errors fall through to 500.
 *
 * Closed-core, open-runtime — matches #576 / #580 / #769:
 * - `providerName` is a free string (no closed `KnownProvider` union); plugins
 *   register their own. Today: 'inpost', 'allegro'.
 * - `providerCode` is the discriminator the controller / future operator-
 *   facing UI / structured logs key on. Free string by design — adapters carry
 *   the carrier's code verbatim; core does not enumerate.
 * - `providerDetails` is an open-shape per-plugin payload (e.g. ShipX field
 *   errors, Allegro command errors, the operator-selected paczkomatId for
 *   re-tagged locker failures). Consumers narrow at the boundary.
 */
export class ShippingProviderRejectionException extends Error {
  constructor(
    public readonly providerName: string,
    public readonly providerCode: string | null,
    message: string,
    public readonly providerDetails?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ShippingProviderRejectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

Three changes from the PR-#881 shape:

1. **`super(message)`** — no `"Shipping provider X rejected the command:"`
   prefix. The structured `providerName` carries that context already; the
   `message` is operator-readable verbatim. This restores the message shape
   that `InpostValidationException` / `AllegroShipmentRejectedException`
   already produce (so the migration doesn't regress operator log
   readability, and the InPost adapter spec at line 121 — which asserts
   `error.message === 'invalid target_point'` — keeps passing).
2. **`providerDetails?: Record<string, unknown>`** — new open-shape field.
   `Record<string, unknown>` is loose enough that plugins can write any
   serialisable JSON-shape payload, tight enough that consumers get
   key-accessible discrimination without full `unknown` ceremony.
   Optional — the parameter-less throws (`null` providerCode + no
   providerDetails) stay legal.
3. The `name = 'ShippingProviderRejectionException'` line stays as-is —
   there are no subclasses to override it from anymore.

### 3.2 Plugin-side throw-site shapes

**InPost — ShipX 4xx (HTTP client):**

```ts
// libs/integrations/inpost/src/infrastructure/http/inpost-http-client.ts:149
throw new ShippingProviderRejectionException(
  'inpost',
  firstDetailKey(errorBody?.details),  // e.g. 'target_point', 'sender', 'parcels', or null
  message,
  errorBody?.details ? { fieldErrors: errorBody.details } : undefined,
);
```

`firstDetailKey` is a local helper inside the HTTP client; the closest thing
ShipX surfaces to an error code is the first field key of the structured
error map.

**InPost — adapter pre-flight (mapper):**

```ts
// libs/integrations/inpost/src/infrastructure/mappers/inpost-shipx.mapper.ts

// Each pre-flight gate gets a stable `providerCode` so logs/UI can
// discriminate. Pre-flight codes are namespaced `preflight.*` to distinguish
// from carrier-surfaced codes.
throw new ShippingProviderRejectionException('inpost', 'preflight.unsupported-method', message);
throw new ShippingProviderRejectionException('inpost', 'preflight.missing-paczkomat-id', message);
throw new ShippingProviderRejectionException('inpost', 'preflight.missing-parcel-template', message);
throw new ShippingProviderRejectionException('inpost', 'preflight.missing-recipient-address', message);
throw new ShippingProviderRejectionException('inpost', 'preflight.missing-dimensions-or-weight', message);
```

**InPost — paczkomat re-tag (adapter):**

The current code unwraps an `InpostValidationException` whose `details`
mentions `target_point` and re-throws as `PaczkomatUnavailableException(message, paczkomatId)`.
Under replace:

```ts
// libs/integrations/inpost/src/infrastructure/adapters/inpost-shipping.adapter.ts
} catch (error) {
  if (
    error instanceof ShippingProviderRejectionException &&
    error.providerName === 'inpost' &&
    cmd.paczkomatId &&
    mentionsTargetPoint(error)
  ) {
    throw new ShippingProviderRejectionException(
      'inpost',
      'target_point',  // the re-tag's whole point: stable, operator-actionable code
      error.message,
      { paczkomatId: cmd.paczkomatId, fieldErrors: error.providerDetails?.fieldErrors },
    );
  }
  throw error;
}
```

`mentionsTargetPoint` now reads from `error.providerDetails?.fieldErrors`
(typed via `Record<string, unknown>` — narrow at the call site) and
`error.message` (unchanged).

**Allegro — adapter rejections:**

```ts
// libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts

// Line 85 — unsupported shipping method (adapter capability):
throw new ShippingProviderRejectionException(
  'allegro',
  'preflight.unsupported-method',
  `Allegro Delivery does not support shipping method '${cmd.shippingMethod}'`,
);

// Line 111 — SUCCESS-without-shipmentId (provider contract violation):
throw new ShippingProviderRejectionException(
  'allegro',
  'command.success-without-shipment-id',
  `Allegro create-command ${commandId} succeeded without a shipmentId`,
);

// Line 181 — ERROR-state command result (carrier-side rejection):
throw new ShippingProviderRejectionException(
  'allegro',
  firstAllegroErrorCode(result.errors),  // e.g. 'DELIVERY_METHOD_NOT_AVAILABLE'
  `Allegro command ${commandId} failed: ${formatCommandErrors(result.errors)}`,
  { errors: result.errors },
);

// Line 203 — wrapped AllegroApiException (transport-side rejection):
return new ShippingProviderRejectionException(
  'allegro',
  'api.http-error',  // generic — no code is surfaced by AllegroApiException for this path
  `Failed to ${context}: ${error.message}`,
);
```

**Allegro — mapper pre-flight:**

```ts
// libs/integrations/allegro/src/infrastructure/mappers/allegro-shipment.mapper.ts
throw new ShippingProviderRejectionException('allegro', 'preflight.missing-delivery-method-id', message);
throw new ShippingProviderRejectionException('allegro', 'preflight.missing-parcel-dimensions', message);
```

### 3.3 `providerCode` taxonomy — namespacing decision

To keep discrimination unambiguous between carrier-surfaced codes and
adapter pre-flight codes:

- **Carrier-surfaced codes** are whatever the provider returns —
  uppercase / snake_case from Allegro (`DELIVERY_METHOD_NOT_AVAILABLE`),
  snake_case field keys from ShipX (`target_point`, `sender`, `parcels`).
- **Adapter pre-flight codes** use the `preflight.*` prefix
  (`preflight.unsupported-method`, `preflight.missing-paczkomat-id`).
- **Adapter pseudo-codes for malformed-provider-responses** use
  `command.*` or `api.*` (`command.success-without-shipment-id`,
  `api.http-error`) — covers the cases where the provider didn't supply
  a code but the adapter knows what's wrong.

This namespacing isn't enforced by core (the field is just `string | null`);
it's a convention adapters follow so consumers can discriminate by prefix.

### 3.4 `providerDetails` shape — convention, not contract

Each plugin shapes its own payload. The conventions for the two we touch:

- **InPost field-validation rejections**: `{ fieldErrors: { fieldName: [code, code] } }`
- **InPost paczkomat re-tag**: `{ paczkomatId: string, fieldErrors?: { … } }`
- **Allegro command errors**: `{ errors: AllegroShipmentCommandError[] }`
- **Allegro pre-flight + API wrapping**: undefined (no structured payload)

These conventions are documented in JSDoc on the exception class and
restated as comments at each throw site. Core doesn't lock the shape.

### 3.5 Spec migration

For each spec that currently asserts on a leaf class, the replacement
pattern is:

```ts
// Before:
await expect(adapter.generateLabel(cmd)).rejects.toBeInstanceOf(PaczkomatUnavailableException);

// After:
await expect(adapter.generateLabel(cmd)).rejects.toMatchObject({
  name: 'ShippingProviderRejectionException',
  providerName: 'inpost',
  providerCode: 'target_point',
  providerDetails: expect.objectContaining({ paczkomatId: 'POZ08A' }),
});
```

For cases where the test already asserts `error.details` or `error.errors`
on the leaf class, the field read moves to `error.providerDetails?.fieldErrors`
or `error.providerDetails?.errors`.

### 3.6 New spec: the base-class contract

`libs/core/src/shipping/domain/exceptions/__tests__/shipping-provider-rejection.exception.spec.ts`:

```ts
describe('ShippingProviderRejectionException', () => {
  it('exposes providerName + providerCode + message verbatim', () => { ... });
  it('makes providerDetails optional (legal with 3 args)', () => { ... });
  it('does not prefix the message with "Shipping provider X rejected..."', () => { ... });
  it('has a stable `name` field for log filtering', () => { ... });
  it('captures a stack trace', () => { ... });
});
```

This is the **closed-core contract** spec — it documents what plugins
inherit when they throw the base. Lives next to the class.

### 3.7 What gets deleted

- `libs/integrations/inpost/src/domain/exceptions/inpost-validation.exception.ts` (file)
- `libs/integrations/inpost/src/domain/exceptions/paczkomat-unavailable.exception.ts` (file)
- `libs/integrations/allegro/src/domain/exceptions/allegro-shipment-rejected.exception.ts` (file)
- Three lines from plugin barrels (`libs/integrations/inpost/src/index.ts:15-16`, `libs/integrations/allegro/src/index.ts:53`)
- All import statements of these three classes across the migrated files

## 4. Step-by-step implementation plan

| # | Action | File(s) | Acceptance |
|---|---|---|---|
| 1 | Refactor `ShippingProviderRejectionException` — drop message prefix, add `providerDetails?: Record<string, unknown>` field, update JSDoc to document the closed-core / open-runtime stance and the `providerCode` namespacing convention | `libs/core/src/shipping/domain/exceptions/shipping-provider-rejection.exception.ts` | Signature is `(providerName, providerCode, message, providerDetails?)`. Existing controller-spec at `shipment.controller.spec.ts` still passes (assertion is `instanceof`, not message-equality). |
| 2 | Add base-exception spec | `libs/core/src/shipping/domain/exceptions/__tests__/shipping-provider-rejection.exception.spec.ts` | 5 assertions per §3.6. |
| 3 | Migrate InPost HTTP client throw site | `libs/integrations/inpost/src/infrastructure/http/inpost-http-client.ts:149` | Throws `ShippingProviderRejectionException('inpost', firstDetailKey, message, { fieldErrors })`. New local `firstDetailKey` helper. |
| 4 | Migrate InPost mapper pre-flight throws | `libs/integrations/inpost/src/infrastructure/mappers/inpost-shipx.mapper.ts:111, 165, 168, 184, 188` | 5 throw sites swapped; each carries its stable `preflight.*` code per §3.2. |
| 5 | Migrate the paczkomat re-tag site in the InPost adapter | `libs/integrations/inpost/src/infrastructure/adapters/inpost-shipping.adapter.ts:70-77, 117-122` | Catch reads `instanceof ShippingProviderRejectionException && providerName === 'inpost'`. Re-throw is the base class with `providerCode='target_point'` + `providerDetails: { paczkomatId, fieldErrors }`. `mentionsTargetPoint` reads `error.providerDetails?.fieldErrors`. |
| 6 | Migrate InPost fake-adapter throws | `libs/integrations/inpost/src/testing/fake-inpost-shipping.adapter.ts:27, 54, 59` | Same throw shape as the real mapper. |
| 7 | Migrate Allegro delivery adapter throws | `libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts:85, 111, 181, 203` | 4 throw sites swapped per §3.2. `firstAllegroErrorCode` helper introduced. |
| 8 | Migrate Allegro mapper pre-flight throws | `libs/integrations/allegro/src/infrastructure/mappers/allegro-shipment.mapper.ts:88, 96` | 2 throw sites swapped with `preflight.*` codes. |
| 9 | Delete leaf exception files | `libs/integrations/inpost/src/domain/exceptions/{inpost-validation,paczkomat-unavailable}.exception.ts`, `libs/integrations/allegro/src/domain/exceptions/allegro-shipment-rejected.exception.ts` | 3 files removed. |
| 10 | Remove leaf exports from plugin barrels | `libs/integrations/inpost/src/index.ts:15-16`, `libs/integrations/allegro/src/index.ts:53` | 3 lines removed. |
| 11 | Update JSDoc name-drops of leaf classes | `libs/integrations/inpost/src/domain/exceptions/inpost-config.exception.ts:6`, `libs/integrations/inpost/src/infrastructure/http/inpost-http-client.interface.ts:28` | References point at `ShippingProviderRejectionException`. |
| 12 | Migrate InPost HTTP client spec — drop leaf import; replace `instanceof InpostValidationException` with discriminator-field assertions | `libs/integrations/inpost/src/infrastructure/http/__tests__/inpost-http-client.spec.ts:11, 88-104` | Assertions use `providerName`/`providerCode`/`providerDetails`. |
| 13 | Migrate InPost mapper spec | `libs/integrations/inpost/src/infrastructure/mappers/__tests__/inpost-shipx.mapper.spec.ts` | All 4 `toThrow(InpostValidationException)` cases swapped to base class + code assertions. |
| 14 | Migrate InPost adapter spec | `libs/integrations/inpost/src/infrastructure/adapters/__tests__/inpost-shipping.adapter.spec.ts:121-128` | Re-tag assertion uses `providerName='inpost'` + `providerCode='target_point'` + `providerDetails.paczkomatId`. |
| 15 | Migrate InPost fake-adapter spec | `libs/integrations/inpost/src/testing/__tests__/fake-inpost-shipping.adapter.spec.ts` | Discriminator-field assertions. |
| 16 | Migrate Allegro adapter spec | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-delivery-shipping.adapter.spec.ts:139-176, 270` | All `AllegroShipmentRejectedException` cases swapped to base + code assertions. |
| 17 | Migrate Allegro mapper spec | `libs/integrations/allegro/src/infrastructure/mappers/__tests__/allegro-shipment.mapper.spec.ts` | Discriminator-field assertions. |
| 18 | `pnpm lint && pnpm type-check && pnpm test` | — | All green. |
| 19 | Self-review per `docs/code-review-guide.md` | this plan + diff | No BLOCKING / IMPORTANT items remain. |
| 20 | Commit (conventional-commit message); push; open PR with `Closes #885` | — | PR opened, CI seeded. |

## 5. Validation

### 5.1 Architecture compliance

- **Closed-core / open-runtime pattern.** Matches #576 / #580 / #769 (the
  one just shipped) verbatim. The new exception is in the plugin contract
  surface; the seam is open at the discriminator-string boundary. ✓
- **Hexagonal boundaries.** Base exception in `libs/core/src/shipping/domain/exceptions/`
  (correct). Plugin code value-imports via `@openlinker/core/shipping` (the
  top-level barrel — already wired by #881). ✓
- **Cross-context import rule** (engineering-standards.md § Import
  Aliases). Plugins consume the base via the top-level barrel, never a
  deep path. ✓
- **Naming.** File pattern `*.exception.ts` ✓; class `*Exception` ✓.
- **Anemic-by-default domain.** Pure constructor + readonly fields, no
  methods, no I/O. ✓

### 5.2 Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Breaking change to plugin barrel exports (`InpostValidationException` / `PaczkomatUnavailableException` / `AllegroShipmentRejectedException` removed) | Certain | No downstream consumer in `apps/*` or `libs/core` references these by name — verified by grep. The barrel exports were unread. Acting now keeps the surface minimal before consumers calcify. The change is documented in the PR body + commit message. |
| Message-shape change at `BadGatewayException` body (no more `"Shipping provider X rejected..."` prefix) | Certain | This is the *intent* — restores operator-readable messages the leaf classes already produced. Controller-spec asserts on `instanceof`, not message-equality. |
| Pre-flight gates now classify as "provider rejection" (502) where they could arguably be 422 | Low | Pre-flight gates today already throw `InpostValidationException` / `AllegroShipmentRejectedException`, which after this migration land at 502 anyway. The semantic equivalence is correct: a missing paczkomatId would 100% be rejected by ShipX if forwarded. Same operator-actionability either way. |
| The Allegro `toRejected` 5xx-via-`AllegroApiException` widening propagates as a 502-classed rejection | Inherited from #833 | Out of scope per §1 non-goals. The current adapter behaviour is preserved verbatim — only the exception class identity changes. |
| `providerDetails: Record<string, unknown>` loosens TypeScript at consumer sites | Low | Consumers narrow at the boundary (one `if (typeof error.providerDetails?.paczkomatId === 'string')` line). Closed-shape unions would defeat the open-world point — see #576's `CoreCapability | string` precedent for the same trade-off. |
| Bare `Error` thrown elsewhere in the adapter chain (not migrated this cycle) still gets 500 | Intentional | The migration intentionally narrows to "things that are currently rejection-shaped". Auth / transport / network failures stay as their own typed exceptions and 500. |

### 5.3 Test coverage

- 1 new base-exception spec (5 assertions on the closed-core contract).
- 6 specs migrated from leaf-`instanceof` to discriminator-field
  assertions. Net coverage: unchanged or slightly improved (each migration
  asserts the rejection's `providerCode`, which the leaf-class tests did
  not).
- No int-spec changes — controller-side mapping was validated in PR #881.

### 5.4 Security

No new HTTP, auth, persistence, or user-input surface. `providerCode` /
`providerDetails` values are sourced from carrier API response fields the
adapters already trust + log.

### 5.5 Performance

Zero runtime cost. One fewer object allocation per rejection (no leaf
wrapping). No hot-path impact (rejection path is the rare path).

## 6. Open questions / deferred follow-ups

None blocking this cycle. Possible future follow-ups (not filed):

- **`providerName` migration to a registry.** Today plugins free-string
  their `providerName`. If/when a runtime check is desirable
  ("this exception's providerName isn't registered to any plugin"), file
  a follow-up to extend the existing adapter-registry. Matches the
  capability-registry pattern (#576).
- **Per-pre-flight-code FE rendering.** The stable `preflight.*` /
  `command.*` codes are operator-actionable. A future FE PR could map
  them to friendly copy ("This paczmokat isn't available — pick another").
  Today the raw `message` is rendered, which is good enough.
- **`AllegroApiException` 5xx widening tightening.** `toRejected` wraps
  both 4xx and 5xx into the new base. Tightening to "only when status <
  500" is a future correctness pass — but it's #833's existing behaviour
  and out of this cycle's contract.
