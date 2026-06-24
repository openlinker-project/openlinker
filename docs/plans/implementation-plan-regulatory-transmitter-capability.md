# Implementation Plan — RegulatoryTransmitter sub-capability port + guard (#1143)

**Branch:** `1143-regulatory-transmitter-capability`
**Epic:** #1142 (KSeF e-invoicing), child C1
**Layer:** CORE (invoicing domain — ports/capabilities + types + barrel; no infra, no service, no migration)
**Design source:** [ADR-026 §Decision.2](../architecture/adrs/026-country-agnostic-invoicing-domain.md) + [ADR-002](../architecture/adrs/002-capability-ports-with-sub-capabilities.md)

## 1. Goal & non-goals

Define the deferred **regulatory clearance** sub-capability(ies) on the invoicing
`InvoicingPort`, as the neutral seam every CTC regime (KSeF / IT SDI / ES SII)
maps onto. `InvoiceRecord` already carries the persistence columns
(`regulatoryStatus`, `clearanceReference`, from #751) — this issue adds the
**interface + guard** that describes who populates them.

**Non-goals (explicit):** any KSeF/provider implementation (C5/C6); the
reconciliation worker job (#1121); any service wiring or `InvoiceService` change;
any ORM/migration (columns exist, nullable — ADR-026 guarantees no schema change).

## 2. The reconciliation decision (the crux — #1143 ⇄ #1121)

#1143 frames a `RegulatoryTransmitter` (`submitForClearance` + `getClearanceStatus`).
#1121 (collaborator) independently needs a **read-only** path: for Subiekt, the
provider transmits to KSeF *natively* — OL only **reads** clearance status, never
submits. ADR-026 §Decision.2 names only `RegulatoryTransmitter` with both methods.

**Decision — Option (a): segregate the read half; the transmitter extends it.**

- `RegulatoryStatusReader` — the read half: `getClearanceStatus(record)`. A
  provider OL only polls (Subiekt) implements **this and only this**.
- `RegulatoryTransmitter extends RegulatoryStatusReader` — adds
  `submitForClearance(record)`. A provider OL submits to directly (a future
  KSeF-direct adapter) implements the full interface; by extension it is also a
  reader.

**Why (a) over (b) — a single transmitter with both methods:**
- **ISP.** Subiekt cannot honour `submitForClearance` (it doesn't submit); forcing
  it to implement a throwing stub to satisfy a fat interface is the LSP/ISP smell
  ADR-002 guards exist to avoid.
- **Unblocks both issues cleanly.** #1143 defines *both* capabilities here (the
  transmitter can't `extend` a reader that doesn't exist), so #1121 just *consumes*
  `RegulatoryStatusReader` + `isRegulatoryStatusReader` — zero definition
  collision, no "who owns the file" race.
- **The reconciliation poller (#1121) narrows on the read guard** (`isRegulatoryStatusReader`),
  so it works for *both* a read-only Subiekt adapter and a full transmitter.
- Matches the established `OfferManagerPort` sub-capability idiom (`isOfferCreator(adapter: OfferManagerPort)`).

This refines (does not contradict) ADR-026 — it extracts a narrower read capability
from the named `RegulatoryTransmitter`. Per the issue, record it as a **one-line
ADR-026 amendment note** and a coordination comment on #1121.

### Why `extends` (not two independent flat capabilities) — research-backed

Deep research (2026-06-23) on both the codebase and the CTC e-invoicing domain
settled the one open sub-question — `RegulatoryTransmitter extends RegulatoryStatusReader`
vs two independent flat capabilities:

- **Codebase idiom is flat/independent — but for a reason that doesn't apply here.**
  No capability interface in `libs/core` currently uses `extends`; the closest
  read/write pair (`FulfillmentStatusReader` vs `OrderFulfillmentUpdater`) is two
  *independent* interfaces. That is correct **because those concerns are
  orthogonal** — reading the OMP's fulfilment view and pushing a status to it are
  different directions with no subset relationship; an adapter can sensibly have
  one without the other.
- **The regulatory pair is a genuine `is-a`, not orthogonal.** Across clearance
  regimes (PL KSeF, IT SDI) the official reference (KSeF number / IdSdI) is
  assigned *only after* submission and is knowable *only by reading status* — so a
  transmitter that cannot read the clearance status it just triggered is
  meaningless. Submit logically entails read. This is exactly the LSP subset
  relationship that warrants interface inheritance, where the prior orthogonal
  pairs did not. `extends` is therefore the first such use in the codebase **by
  correctness, not by accident** — a bounded, documented exception, not a new
  sweeping pattern.
- **Single read-guard coverage.** `extends` makes `isRegulatoryStatusReader`
  structurally true for *every* transmitter (a transmitter is always a reader), so
  the #1121 poller's one guard covers both Subiekt (read-only) and a future
  KSeF-direct (transmitter) with no "the adapter forgot to also declare the reader"
  failure mode.

**External validation (durability):** the submit-vs-read-status split is the
industry-standard, durable model, not a Subiekt quirk — Poland's KSeF defines
`InvoiceRead` and `InvoiceWrite` as *independently grantable permissions* (a
principal can hold read without write); Avalara (Send/Receive/Status), Sovos,
Fonoa, Basware/Pagero, and Peppol (status is a *separate document/layer*) all
expose transmit and status as separate operations; ViDA/decentralized-CTC keeps
transmission and reporting structurally separate. A read-only status consumer is a
recurring shape (PL/IT/FR/RO + a decade of LatAm PAC delegation), so the segregation
ages well as more providers/countries are added.

**Spain caveat — already accommodated.** Spain SII / Veri*factu are *synchronous*
real-time reporting (status returned at submit, no clearance poll). Our shape
handles this without change: `submitForClearance` **returns** a
`RegulatoryClearanceResult`, so a synchronous regime reports its final status in
the submit response; `getClearanceStatus` is the *optional* later poll for async
regimes. No interface change is needed to cover RTR regimes.

**Neutral-lifecycle altitude.** Real regimes expose *multiple* status channels
(transport ack, technical MLR/MLS, business response, authority clearance). Core
stays at the right altitude: the adapter collapses that multiplicity onto the
single neutral `RegulatoryStatus` lifecycle + `clearanceReference` already defined
in #751. Core never models the channel zoo.

## 3. Design

### New neutral result type (`domain/types/invoicing.types.ts`)
```ts
/** Outcome of a regulatory clearance submit/read — maps 1:1 onto InvoiceOutcomePatch. */
export interface RegulatoryClearanceResult {
  regulatoryStatus: RegulatoryStatus;        // existing neutral CTC lifecycle (#751)
  clearanceReference?: string | null;        // authority ref (KSeF number, SDI id…), when present
}
```
Both methods return this; it maps directly onto the existing `InvoiceOutcomePatch`
(`regulatoryStatus` + `clearanceReference`) so a future service calls
`repo.updateOutcome(...)` with no translation. Named `…Result` (not `…Snapshot`):
it is returned by **both** submit and read, so a read-only-implying name would
mislead.

### Error / outcome contract (the seam #1121's poller and C5/C6 must agree on)
Both methods follow the established outcome-as-data-vs-throw discipline (mirrors
`OrderWritebackResult` + engineering-standards § Error Handling), pinned in each
method's JSDoc:
- **Business outcome → returned as data.** An authority verdict — including a
  refusal — is a returned `RegulatoryClearanceResult` with the mapped neutral
  status (`rejected`, `cleared`, `accepted`, `submitted`). `rejected` is a
  first-class `RegulatoryStatusValues` member, **not** an exception.
- **Transport / infrastructure failure → throws.** Inability to reach the
  authority/provider (network, auth, 5xx) throws for the caller (the future
  `InvoiceService` / #1121 poller) to handle + retry. The adapter converts
  provider-native errors at its boundary.

### `RegulatoryStatusReader` (`domain/ports/capabilities/regulatory-status-reader.capability.ts`)
```ts
export interface RegulatoryStatusReader {
  /**
   * Read the current clearance status of an issued document from the
   * authority/provider. Returns the neutral status + `clearanceReference` when
   * the authority has assigned one (KSeF number / SDI id are knowable only by
   * reading, post-clearance). A business verdict — incl. `rejected` — is returned
   * as data; a transport/infra failure throws.
   */
  getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult>;
}
export function isRegulatoryStatusReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryStatusReader {
  return typeof (adapter as Partial<RegulatoryStatusReader>).getClearanceStatus === 'function';
}
```

### `RegulatoryTransmitter` (`domain/ports/capabilities/regulatory-transmitter.capability.ts`)
```ts
export interface RegulatoryTransmitter extends RegulatoryStatusReader {
  /**
   * Transmit an issued document to the tax authority for clearance. Returns the
   * neutral status the submit yielded (a synchronous regime — Spain SII — reports
   * the final status here; an async regime returns `submitted` and the caller
   * later polls `getClearanceStatus`). A business refusal is returned as
   * `rejected` data; a transport/infra failure throws. Should be a no-op
   * returning current status if re-submitted for an already-cleared document
   * where the regime allows.
   */
  submitForClearance(record: InvoiceRecord): Promise<RegulatoryClearanceResult>;
}
export function isRegulatoryTransmitter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & RegulatoryTransmitter {
  return typeof (adapter as Partial<RegulatoryTransmitter>).submitForClearance === 'function';
}
```

**File-header rationale (required, not just the ADR note).** `regulatory-transmitter.capability.ts`'s
header must explain *why* it `extends` (the first capability inheritance in the
codebase): "a transmitter is necessarily also a reader — the authority reference
is knowable only by reading post-submit, a genuine is-a — unlike OL's orthogonal
`*Reader`/`*Updater` pairs; do **not** cargo-cult `extends` for orthogonal
capabilities." Keeps the bounded exception from being copied where it doesn't apply.

**Method input = `InvoiceRecord`** (not a bare `clearanceReference`): the record is
the richest neutral handle the adapter can use (carries `clearanceReference`,
`providerInvoiceId`, `orderId`, `connectionId`) and always exists at both call
sites (the poller selects records; the submit path has a just-issued record). The
adapter picks what it needs. Matches `submitForClearance(record)` in ADR-026 §Flow.

**Neutral-vocabulary litmus (ADR-026):** zero `nip`/`ksef`/`vat`/`jpk`/`faktura`
strings in the new files. (Note: there is no *automated* neutral-vocab invariant
script in `check:invariants` today — cross-context is the only relevant gate; the
litmus is enforced by review + these tests. Not introducing a new script — out of
scope.)

### Barrel (`index.ts`)
Add `export * from './domain/ports/capabilities/regulatory-status-reader.capability';`
and `…/regulatory-transmitter.capability';`. **No token** (capability-resolved
per-connection via `isRegulatoryTransmitter`/`isRegulatoryStatusReader`).

## 4. Steps

1. `invoicing.types.ts` — add `RegulatoryClearanceResult` (after the existing
   `RegulatoryStatus` block). Header litmus already present.
2. Create `regulatory-status-reader.capability.ts` (interface + guard + header).
3. Create `regulatory-transmitter.capability.ts` (`extends` reader + guard + header).
4. Barrel: export both capability modules from `index.ts`.
5. `__tests__/regulatory-capabilities.spec.ts` — guard unit tests (see §5).
6. ADR-026 — **append** a dated `## Amendments` section recording how the deferred
   interface was filled. Do **not** edit Decision 2's body (ADRs are append-only —
   `docs/architecture/adrs/README.md`; this *refines*, not *changes*, the decision,
   since Decision 2 explicitly defers the interface "to the KSeF issue" = #1143). Text:
   > **Amendment (2026-06-23, #1143).** The deferred `RegulatoryTransmitter` interface
   > (Decision 2) is realized as two ADR-002 sub-capabilities: a read-only
   > `RegulatoryStatusReader` (`getClearanceStatus`) and `RegulatoryTransmitter extends
   > RegulatoryStatusReader` (adds `submitForClearance`). Providers that transmit natively
   > and only expose status (Subiekt → KSeF, #1121) implement the reader alone; providers
   > OL submits to directly implement the full transmitter. This refines, not changes,
   > Decision 2 — it fills the interface ADR-026 deferred to the KSeF issue.
7. Coordination comment on #1121 announcing `RegulatoryStatusReader` is defined here.

## 5. Tests (`__tests__/regulatory-capabilities.spec.ts`)

Mock a minimal `InvoicingPort` base (the 4 base methods as `jest.fn()`), then:
- `isRegulatoryStatusReader`: **true** when `getClearanceStatus` present; **false** on the base port.
- `isRegulatoryTransmitter`: **true** when `submitForClearance` present; **false** on the base port and **false** on a reader-only adapter (segregation: a reader is not a transmitter).
- A full transmitter (both methods) narrows **true** under *both* guards (the `extends` contract — a transmitter is always a reader).
- Post-narrow type access compiles (the guard actually narrows the method on).

## 6. Validation / risks

- **Architecture:** pure domain ports + types + guards; no NestJS/TypeORM in the
  files; no token, no service, no ORM, **no migration**. Cross-context surface:
  only additive barrel exports → `check:invariants` (cross-context) unaffected.
- **Naming:** `*.capability.ts` under `domain/ports/capabilities/`, `is{Capability}`
  guards co-located — matches engineering-standards + ADR-002.
- **Risk — #1121 coordination:** #1121 is open/unclaimed; defining
  `RegulatoryStatusReader` here is the agreed reconciliation. Surfaced via the
  coordination comment; if #1121's author prefers (b), the change is a 1-file
  delta. Low risk.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`. (Backend, but
  no DB/integration surface — `test:integration` not required for this slice;
  will still run the core unit suite.) Rebuild libs dist before type-check on a
  fresh worktree.
