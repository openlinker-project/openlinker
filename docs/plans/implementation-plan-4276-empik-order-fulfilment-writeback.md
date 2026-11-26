# Implementation plan: Empik order fulfilment writeback (#4276)

Part of epic #4273, stacked on #4275.

## Goal

Tell Empik what happened to an order OpenLinker handled: shipped (with carrier
and tracking), cancelled, invoiced; and read back a shipment the seller entered
in the Empik panel. Layer: Integration (`libs/integrations/mirakl`). No core
change: every capability already exists in core.

## Design

`MiraklOrderSourceAdapter` implements four more core sub-capabilities by
delegating to one class each, all over the same `IMiraklHttpClient`:

| Capability | Class | Mirakl calls |
|---|---|---|
| `OrderStatusWriteback` | `MiraklOrderStatusWriter` | OR11, OR23, OR24, OR29 |
| `OrderFulfillmentReadback` | `MiraklFulfillmentReadback` | OR11 |
| `SourceOptionsReader` | `MiraklSourceOptions` | SH12 |
| `OrderBillingDocumentUploader` | `MiraklOrderDocumentUploader` | OR72, OR74 |

- `mirakl-order-reader.ts`: the one OR11 single-order read, shared.
- `mirakl-order-state.policy.ts`: dispatched / cancelled / ready-to-ship states.
- `mirakl-carrier.policy.ts`: `platformType` -> SH21 code (override, table,
  InPost locker vs courier by shipping type), else free-text carrier name.
- Config: `carrierCodes` (validated). Profile: `invoiceDocumentTypeCode`
  (Empik `CUSTOMER_INVOICE`, DO01 on staging).
- HTTP client: `postFile` takes binary content and extra form fields (OR74
  `order_documents`).

## Decisions

- Every write reads the order first: idempotent replays, no cancel of a shipped
  order, no resend of a tracking number.
- One tracking number per order: a second parcel's is logged, not sent.
- Cancel is OR29 only: core cancels whole orders; OR30 needs an operator reason
  code and has no caller.
- A Mirakl refusal is `rejected` (status + code, never the body); transport
  failures are thrown so the relay treats the outcome as unknown.

## Tests

Unit: policies, writer, readback, options, uploader, client multipart, config
validator. Integration: E7-E10 in `empik-orders-vertical-slice.int-spec.ts`,
resolved through `getCapabilityAdapter` and core's guards.

## Verified on staging (read-only)

SH12 (24 types), OR72 shape, DO01 (`CUSTOMER_INVOICE`), and the writer and
readback against an unknown order. No real staging order exists yet, so the
ship / cancel / invoice acceptance criteria wait for one.
