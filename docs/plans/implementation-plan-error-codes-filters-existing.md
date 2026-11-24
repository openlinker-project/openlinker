# Implementation Plan: explicit codes for the global filters and existing coded responses (#3863, backend)

## 1. Task understanding

**Goal.** The domain exception filters send the exception class NAME as `error`, so renaming a class silently
changes the API contract, and the frontend has no stable code to pick copy by. Every filter now sends an explicit
`code` (and `params`), and every code an endpoint already sends is registered in `ApiErrorCodeValues`, keeping its
value.

**Scope.** Backend only. The frontend half of the issue (rewriting `issue-error-message.ts`, `decline-error.ts`
and the order-hold handling over `describeApiError`) needs #3862 and follows it.

**Base.** `3865-error-codes-remaining-endpoints` (PR #3998).

## 2. Findings

- There are 9 domain filters, not 7: capability, connection, taxonomy source, availability, rate-limit busy,
  inventory location, inventory correction, returns, automation.
- The inventory-correction filter already sends lowercase codes (`confirmation-required`, `contended`, the closed
  refusal reasons). The acceptance criteria keep existing values, so they stay.
- Codes already sent but not registered: the order cancellation and order edit refusal families, the order hold,
  buyer-note, routing-retry and test-fixture codes, the refund codes (lowercase), the fulfilment conflict codes
  (lowercase), the document-email refusal reasons (lowercase), the inventory-correction reasons (lowercase),
  `CHANNEL_PUBLISH_FAILED`, `EXPORT_RANGE_TOO_WIDE`, `CORRECTION_FAILED` and six auth codes.

## 3. Design

- **The code lives in the filter, not as `static code` on the domain exception** (deviation from the issue text).
  A code is the HTTP contract of the interface layer; a core exception is used by the worker and services too and
  should not carry it. The filter's mapping is typed `KnownApiErrorCode`, so it is checked against the registry at
  compile time, and a class rename cannot change it.
- `error` keeps the class name for existing clients, now beside the code. Fields clients read today (`reason`,
  `trigger`, `referrers`, the automation details, the correction thresholds) stay top-level and are also put into
  `params` where they are scalars.
- Three core exceptions expose their constructor arguments as public readonly fields (`connectionId`,
  `status`, `adapterKey`, `capability`) so their params are not parsed out of a message. Additive.
- Code families declared in `apps/api` get a `satisfies readonly KnownApiErrorCode[]`; families declared in core
  (document email, inventory correction, fulfilment conflict, refund codes) are checked by a spec that every value
  is registered, so a new member cannot be sent unregistered.

## 4. New codes

`CAPABILITY_NOT_SUPPORTED`, `CONNECTION_DISABLED`, `CONNECTION_IN_USE`, `TAXONOMY_SOURCE_UNAVAILABLE`,
`AVAILABILITY_UNKNOWN`, `PLATFORM_CONNECTION_BUSY`, `INVENTORY_LOCATION_CODE_DUPLICATE`,
`INVENTORY_LOCATION_IN_USE`, `INVENTORY_LOCATION_OWNER_NOT_FOUND`, `INVENTORY_VARIANT_NOT_FOUND`, `RETURN_*` (one
per returns refusal), `AUTOMATION_*` (one per automation refusal). Reused: `CONNECTION_NOT_FOUND`,
`INVENTORY_LOCATION_NOT_FOUND`, `AUTOMATION_RULE_NOT_FOUND`.

## 5. Tests

Filter specs assert the code and params; a registry spec asserts every core family value is registered; the
existing filter specs keep passing (fields are additive).
