/**
 * Fulfillment Authority — public barrel (#2304)
 *
 * A **dependency-free vocabulary leaf**: types and pure functions only, with no
 * module, service, repository, port or tokens file *at the outset*. This is the
 * posture `sales-documents` established in #2100 and outgrew in #2170, adopted
 * deliberately (ADR-053) — including its documented exemption from
 * `engineering-standards.md § Symbol DI Token Re-export Convention` rule 1,
 * which exists so a concern's DI bindings are discoverable from one place and
 * therefore has nothing to say about a concern with no bindings. When this leaf
 * grows one, it grows an ordinary `fulfillment-authority.tokens.ts`, exactly as
 * `sales-documents` did.
 *
 * **The load-bearing property is ZERO SIBLING-CONTEXT EDGES, not
 * framework-freedom.** Those are two different things, and #2170 narrowed the
 * barrel-purity spec to exactly the second: `sales-documents` acquired a NestJS
 * module and repositories and remained a valid leaf, because nothing under it
 * imports a `@openlinker/core/<ctx>` specifier — value OR type-only. That is the
 * property this directory holds, and the one that matters: resolution lives
 * where the write lives (A1 in `inventory`, A2/A3 in `fulfillment`, A4 in the
 * lifecycle projection, A5 in `returns`, A6 in `orders`), so every one of those
 * contexts will import this leaf, and a single edge back from here would close a
 * CJS module-load cycle. A single `oms-policy` context that resolved everything
 * was rejected for the same graph reason.
 *
 * ## The six authorities (ADR-052's matrix rows A1–A6)
 *
 * `AUTHORITY_KIND_DESCRIPTORS` is the machine-readable source; this table is its
 * prose twin, and the two must agree.
 *
 * | # | `AuthorityKind`         | Capability             | Config key                | Owning context |
 * |---|-------------------------|------------------------|---------------------------|----------------|
 * | A1 | `availability`          | `AvailabilityAuthority` | `availabilityAuthority`  | `inventory`    |
 * | A2 | `sourcing`              | *config-only*           | `sourcingAuthority`      | `fulfillment`  |
 * | A3 | `fulfillment-execution` | `FulfillmentExecutor`   | `fulfillmentExecutor`    | `fulfillment`  |
 * | A4 | `order-lifecycle`       | *config-only*           | `orderLifecycleAuthority`| `orders`       |
 * | A5 | `returns-disposition`   | `ReturnsAuthority`      | `returnsAuthority`       | `returns`      |
 * | A6 | `refund-trigger`        | *config-only*           | `refundTrigger`          | `orders`       |
 *
 * **A7 (invoicing / fiscalization) carries no member, by design.** ADR-052's
 * decision (lines 20–25) enumerates six "with invoicing/fiscalization integrated
 * as already resolved by ADR-041" — shipped code, not a proposal (#2161/#2170) —
 * and DESIGN §2.1's owning-context list names A1–A6 only. A7 does appear in the
 * design's own tables (§2's matrix row; §2.2 groups it with A1/A2/A5/A6 on the
 * config-vs-handshake axis); what it does not have is a resolution that belongs
 * here, because `sales-documents` already owns it. The count is six on purpose.
 *
 * ## Nothing consumes this yet
 *
 * Wave 1a ships vocabulary only: every reason member is declared and never
 * written, and both pure functions have no production caller. The vocabulary
 * ships first so the contexts that adopt it adopt one spelling.
 *
 * @module libs/core/src/fulfillment-authority
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
export * from './domain/types/authority-kind.types';
export * from './domain/types/authority-scope.types';
export * from './domain/types/authority-selection.types';
export * from './domain/types/authority-config.types';
export * from './domain/types/authority-question.types';
export * from './domain/types/authority-resolution.types';
export * from './domain/types/fulfillment-authority-outcome.types';
export * from './domain/types/fulfillment-cancellation-reason.types';
