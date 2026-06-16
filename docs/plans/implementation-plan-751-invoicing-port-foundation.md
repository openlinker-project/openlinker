# Implementation Plan — #751 InvoicingPort + capability + InvoiceRecord + BuyerProfile + migration

**Issue:** [#751](https://github.com/openlinker-project/openlinker/issues/751) · **Parent design:** #728 (`docs/specs/product-spec-728-invoicing-integration.md`)
**Branch:** `751-invoicing-port-foundation`
**Layer:** CORE (new bounded context) + one migration. **No HTTP, no adapter, no FE.**

---

## 1. Understand the task

Stand up the **domain + persistence foundation** for the invoicing bounded context so the downstream adapter (#753), bridge (#752/#755/#756), fake (#754), and FE (#757–#759) issues have a stable contract to build against. Port-first per the #728 Gate-A decision: `InvoicingPort` is the capability; Subiekt is merely its first adapter (out of scope here).

**Explicit non-goals (from the issue):**
- Subiekt adapter (#753), bridge service (#752/#755/#756), fake adapter (#754).
- HTTP API surface (no controller/DTO — v1 only an adapter consumes the port).
- Any FE work.
- Identifier-mapping of provider invoice/customer ids (adapter concern, #753).

**Classification:** CORE domain logic + infrastructure persistence + DX (ADR).

---

## 2. Research findings (conventions to mirror)

- **Context template:** `libs/core/src/content/` — barrel `index.ts`, `*.tokens.ts`, `orm-entities.ts` sub-barrel, `<ctx>.module.ts`, `domain/{entities,ports,types,exceptions}`, `infrastructure/persistence/{entities,repositories}`.
- **Barrel rule (#594):** ORM entities are NOT exported from `index.ts`; they go on the host-only `@openlinker/core/invoicing/orm-entities` sub-path.
- **`package.json` exports:** add `./invoicing` + `./invoicing/orm-entities` (mirror the `./content` pair). `tsconfig.base.json` needs **no** change — the `@openlinker/core/*` wildcard already resolves.
- **Domain entities:** plain `public readonly` constructors, zero framework imports, derived state as getters only (ADR-011).
- **`as const` unions:** `const XValues = [...] as const; type X = (typeof XValues)[number]`.
- **ORM entity:** `@Entity('snake_table')`, `@PrimaryGeneratedColumn('uuid')`, `{ type: 'text'|'uuid'|'jsonb', nullable }`, `@CreateDateColumn`/`@UpdateDateColumn`, named `@Index` for partial indexes.
- **Repository:** `@Injectable() implements XRepositoryPort`, `@InjectRepository(OrmEntity)`, private `toDomain` / `buildOrmEntity`.
- **Module:** `TypeOrmModule.forFeature([OrmEntity])`, bind token via `useExisting`, export the token.
- **Migration:** `apps/api/src/migrations/{13-digit}-{desc}.ts`; class name repeats the suffix; raw-SQL `up()`+`down()`; idempotency guards (`IF NOT EXISTS`); timestamp must exceed every migration on `origin/main` (max today `1807000000000`) → use **`1808000000000`**. Auto-discovered by the data-source glob; no registration needed.
- **Capability registry:** `CoreCapabilityValues` in `libs/core/src/integrations/domain/types/adapter.types.ts` — add `'Invoicing'` (open-string set; runtime gate validates against adapter metadata, but the well-known list should carry it). A spec at `adapter.types.spec.ts` pins the array → update it.
- **ADR-026 written** (`docs/architecture/adrs/026-country-agnostic-invoicing-domain.md`, indexed): country-agnostic invoicing domain + capability decomposition. Standards research (EN 16931 / UNTDID 1001 / UNCL 5305 / ISO 6523, and Stripe/Avalara/Fonoa/BaseLinker API shapes) drives the type vocabulary below; the original "novel runtime `getCapabilities()`" idea was **rejected** in favour of an ADR-002 sub-capability for regulatory transmission (deferred).

---

## 3. Design

### Capability resolution model
`InvoicingPort` is a **registry capability** (`'Invoicing'`), resolved per-connection via `IntegrationsService.getCapabilityAdapter<InvoicingPort>(connId, 'Invoicing')` — same shape as `OfferManagerPort`/`ShopProductManagerPort`. So there is **no fixed DI token** for the port; the only token is for the repository.

### Capability decomposition (ADR-026)
1. **Registry capability** `'Invoicing'` → adapter resolution (`CoreCapabilityValues`).
2. **Issuance** = base `InvoicingPort` methods (every invoicing adapter implements).
3. **Regulatory transmission/clearance** = an **ADR-002 sub-capability** `RegulatoryTransmitter` (`isRegulatoryTransmitter` guard) — method-bearing (`submitForClearance`, `getClearanceStatus`). **Interface DEFERRED to the KSeF issue**; #751 only carries its nullable persistence columns. KSeF/SDI/SII are instances; a non-PL adapter omits the guard.
4. **Document-type support** = a small runtime discovery method `getSupportedDocumentTypes(): DocumentType[]` on the base port (Avalara `GetMandates` precedent) — value-level variance, not method-bearing.

### Domain types (`domain/types/invoicing.types.ts`) — standards-aligned (ADR-026)
```ts
// Document type — OPEN-WORLD (regimes vary unbounded). Well-known neutral values
// align to UNTDID 1001 functional types + `receipt` (the regime value the standard omits).
export const DocumentTypeValues =
  ['invoice', 'receipt', 'credit-note', 'corrected', 'proforma', 'prepayment'] as const;
export type DocumentType = (typeof DocumentTypeValues)[number] | string; // open-world

export const InvoiceStatusValues = ['pending', 'issued', 'failed'] as const;       // issuance lifecycle
export type InvoiceStatus = (typeof InvoiceStatusValues)[number];

// Neutral CTC clearance lifecycle (adapter maps KSeF/SDI/SII regime states onto it).
export const RegulatoryStatusValues =
  ['not-applicable', 'submitted', 'cleared', 'accepted', 'rejected'] as const;
export type RegulatoryStatus = (typeof RegulatoryStatusValues)[number];

export const BuyerTypeValues = ['company', 'private'] as const;                     // neutral B2B/B2C axis
export type BuyerType = (typeof BuyerTypeValues)[number];

// Scheme-tagged tax identifier — EN 16931 BT-30 / ISO 6523 / Stripe `tax_ids` shape.
// `scheme` is an OPEN string ('pl-nip', 'eu-vat', 'de-ustid'); core never names a country's system.
export interface TaxIdentifier { scheme: string; value: string }

export interface BuyerAddress {
  line1: string; line2: string | null; city: string; postalCode: string; countryIso2: string;
}

export interface InvoiceLine { name: string; quantity: number; unitPriceGross: number; taxRate: string }
// taxRate is a neutral string code (NOT `vatRate`); provider resolves to its regime
// (PL zw/np → UNCL 5305 E/O inside the adapter). provider identifier ('subiekt', …) is a plain open string.
```

### Domain entities
- `BuyerProfile` (`domain/entities/buyer-profile.entity.ts`): `name, taxId: TaxIdentifier | null, address: BuyerAddress, type: BuyerType`. Derived getter `isCompany` (pure). **`taxId` is scheme-tagged** (`{ scheme, value }`), never a bare `nip` — the PL adapter maps `pl-nip`; `null` = no tax id. The `buyer.type` (B2B/B2C) + `taxId` presence are *inputs* a future rules layer reads to choose `documentType` — the choice is **not** made in core (ADR-026 §3). `BuyerAddress` is a **local** value shape (not the customers context's `CustomerAddressProjection`) — coupling for a value shape is premature; deliberate duplication.
- `InvoiceRecord` (`domain/entities/invoice-record.entity.ts`): `id, connectionId, orderId, providerType, documentType, status, providerInvoiceId: string | null, providerInvoiceNumber: string | null, regulatoryStatus, clearanceReference: string | null, idempotencyKey: string | null, pdfUrl: string | null, issuedAt: Date | null, errorMessage: string | null, createdAt, updatedAt`.
  - **`connectionId`** — settled: every record table in core is connection-scoped; `findByOrderId` needs it.
  - **`idempotencyKey: string | null`** — persisted from `IssueInvoiceCommand.idempotencyKey`; backs the persistence-layer issue-once guard (dedup index below).
  - **`regulatoryStatus` + `clearanceReference: string | null`** — the (nullable) transmission columns. Defaults `regulatoryStatus='not-applicable'`, `clearanceReference=null` until a future `RegulatoryTransmitter` adapter (KSeF) populates them. Carried now so adding transmission needs **no migration** (ADR-026 migration path).

### Ports
- `domain/ports/invoicing.port.ts` — `InvoicingPort` (base = issuance mechanism; **no `getCapabilities()`** — rejected per ADR-026):
  ```ts
  issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord>;
  getInvoice(query: { orderId: string } | { providerInvoiceId: string }): Promise<InvoiceRecord | null>;
  upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult>;  // BuyerProfile → provider customer id
  getSupportedDocumentTypes(): DocumentType[];                                // runtime discovery (Avalara GetMandates precedent)
  ```
  The port is a **pure mechanism** — it does not decide whether/when/what-type to issue (ADR-002 §3 separation; a future ECA rules layer composes the command). `documentType` is therefore **command data** (operator/rule-chosen; adapter may derive if absent), not a port branch.
  Command/result types live in `domain/types/invoicing.types.ts`. `IssueInvoiceCommand` carries `{ connectionId, orderId, buyer: BuyerProfile, currency: string, lines: InvoiceLine[], documentType?: DocumentType, idempotencyKey? }`. **`currency`** (ISO 4217) sits on the command (single-currency invoice), mirroring the codebase `{ amount, currency }` money convention. `InvoiceLine = { name, quantity, unitPriceGross: number, taxRate: string }` — numeric amount per core's `number` money idiom; `taxRate` a neutral string code the provider resolves.
  - `getInvoice` presence-discriminated union `{ orderId } | { providerInvoiceId }`; `providerInvoiceId` wins if both supplied.
- `domain/ports/capabilities/regulatory-transmitter.capability.ts` — **DEFERRED to the KSeF issue, not built in #751.** Documented here as the ADR-026 landing spot: `RegulatoryTransmitter { submitForClearance(...); getClearanceStatus(...) }` + co-located `isRegulatoryTransmitter` guard. #751 ships only the nullable `regulatoryStatus`/`clearanceReference` columns it will later populate.
- `domain/ports/invoice-record-repository.port.ts` — `InvoiceRecordRepositoryPort`: `create(input: CreateInvoiceRecordInput): Promise<InvoiceRecord>`, `findById(id)`, `findByOrderId(orderId, connectionId)`, `findByIdempotencyKey(connectionId, idempotencyKey)`, `updateOutcome(id, patch: InvoiceOutcomePatch): Promise<InvoiceRecord>`. Minimal surface — no findAll/pagination until a consumer needs it. `findByIdempotencyKey` is the read half of the issue-once gate (#755 checks it before issuing).

### Infrastructure
- `infrastructure/persistence/entities/invoice-record.orm-entity.ts` — `@Entity('invoice_records')`; indexes `(orderId, connectionId)`, `(connectionId)`, `(status)`, partial `(providerInvoiceId) WHERE providerInvoiceId IS NOT NULL`, and the **fiscal-dedup guard**: a named **partial UNIQUE index** on `(connectionId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`. This is retry-safety (a re-submitted issue with the same key can't create a second row), consistent with OL's idempotency patterns and the `listing_creation_records` partial-index precedent. Deliberately **not** `UNIQUE(connectionId, orderId)` — legitimate re-issue (faktura korygująca) must stay possible.
- `infrastructure/persistence/repositories/invoice-record.repository.ts` — implements the port; private mappers; `updateOutcome` throws `InvoiceRecordNotFoundException` when the row is absent. `create` converts the Postgres unique-violation on the dedup index into a domain error (`DuplicateInvoiceRecordException`) per the engineering-standards repository error-handling rule (never leak `QueryFailedError`).
- `domain/exceptions/invoice-record-not-found.exception.ts`, `domain/exceptions/duplicate-invoice-record.exception.ts`.

### Wiring
- `invoicing.tokens.ts` — `INVOICE_RECORD_REPOSITORY_TOKEN = Symbol('InvoiceRecordRepositoryPort')` (no port token — capability-resolved).
- `invoicing.module.ts` — `TypeOrmModule.forFeature([InvoiceRecordOrmEntity])`, provide repo + `useExisting` binding, export the token + module.
- `index.ts` barrel — export entities, types, both ports, tokens, module. **Not** the ORM entity.
- `libs/core/package.json` — add `./invoicing` only.
- **`orm-entities.ts` sub-barrel + `./invoicing/orm-entities` export: DEFERRED** (review SUGGESTION). The data-source discovers the ORM entity by filesystem glob (`libs/core/src/**/*.orm-entity.ts`), not via the sub-barrel, so migrations/boot don't need it. The int-spec asserts through the **repository** (domain), so there is no cross-context ORM-entity consumer yet. Per engineering-standards ("add a `<ctx>/orm-entities` sub-barrel only when an external consumer needs it"), skip it until #753/#755 actually imports the entity type — adding it now is premature surface.
- `apps/api/src/app.module.ts` — import `InvoicingModule` (domain+persistence only).
- `libs/core/src/integrations/domain/types/adapter.types.ts` — add `'Invoicing'` to `CoreCapabilityValues`; update `adapter.types.spec.ts`.

### Migration
- `apps/api/src/migrations/1808000000000-create-invoice-records.ts` — `CREATE TABLE invoice_records (...)` + the secondary indexes **and** the partial UNIQUE dedup index on `(connectionId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`; `down()` drops indexes then table. Idempotent guards (`IF [NOT] EXISTS`).

### ADR — `docs/architecture/adrs/026-country-agnostic-invoicing-domain.md` ✅ WRITTEN + indexed
Decision recorded: country-agnostic neutral vocabulary (litmus test: zero `nip`/`ksef`/`vat`/`jpk`/`faktura` in core; standards-aligned field names); capability decomposition (issuance base port + deferred ADR-002 `RegulatoryTransmitter` sub-capability + `getSupportedDocumentTypes` discovery); `documentType` as command data with the port a pure mechanism; idempotency via key + durable dedup. Includes a Mermaid sequence diagram + 9-step flow explanation and the rejected-alternatives list (incl. the originally-proposed novel `getCapabilities()`). Grounded in the standards/platform research (EN 16931, UNTDID 1001, UNCL 5305, ISO 6523; Stripe/Avalara/Fonoa/BaseLinker).

---

## 4. Step-by-step (each with acceptance)

1. **Types** `domain/types/invoicing.types.ts` — all `as const` unions + `BuyerAddress`, `InvoiceLine` (numeric `unitPriceGross`), command/result types incl. `currency` on `IssueInvoiceCommand`. ✅ compiles, no `any`.
2. **Entities** `buyer-profile.entity.ts`, `invoice-record.entity.ts` (incl. `connectionId`, `idempotencyKey`). ✅ readonly ctors, pure getters, no framework imports.
3. **Exceptions** `invoice-record-not-found.exception.ts`, `duplicate-invoice-record.exception.ts`. ✅ extend Error, captureStackTrace.
4. **Ports** `invoicing.port.ts` (`issueInvoice`/`getInvoice`/`upsertCustomer`/`getSupportedDocumentTypes`; **no** `getCapabilities`), `invoice-record-repository.port.ts` (incl. `findByIdempotencyKey`). `RegulatoryTransmitter` sub-capability **deferred** (KSeF issue). ✅ interface-only.
5. **Tokens** `invoicing.tokens.ts`. ✅ Symbol-only file.
6. **ORM entity** `invoice-record.orm-entity.ts`. ✅ `@Entity('invoice_records')` + secondary indexes + partial UNIQUE dedup index.
7. **Repository** `invoice-record.repository.ts` + private mappers; unique-violation → `DuplicateInvoiceRecordException`. ✅ implements port; returns domain entities.
8. **Module** `invoicing.module.ts`. ✅ forFeature + useExisting + export.
9. **Barrel** `index.ts` (no ORM entity; **no** `orm-entities.ts` sub-barrel — deferred). ✅
10. **package.json** exports add `./invoicing` only. ✅
11. **Capability** add `'Invoicing'` to `CoreCapabilityValues` + update `adapter.types.spec.ts`. ✅ spec array updated.
12. **App wiring** import `InvoicingModule` in `app.module.ts`. ✅ boots.
13. **Migration** `1808000000000-create-invoice-records.ts` (cols incl. nullable `regulatoryStatus`/`clearanceReference`/`idempotencyKey`; secondary indexes + partial UNIQUE dedup index). ✅ up+down; `migration:show` clean; ordering guard green.
14. **ADR-026** — ✅ already written + indexed (done ahead of implementation).
15. **Tests** — unit specs:
    - `invoicing.types.spec.ts` (union membership), `invoice-record.entity.spec.ts` / `buyer-profile.entity.spec.ts` (getters),
    - `invoice-record.repository.spec.ts` (mock `Repository<OrmEntity>`; assert create→toDomain mapping, findByOrderId where-clause, `updateOutcome` not-found throw),
    - plus an `*.int-spec.ts` (real Postgres, CI-only) asserting migration up + repository round-trip **and the dedup index** (a second `create` with the same `(connectionId, idempotencyKey)` raises `DuplicateInvoiceRecordException`). ✅ `pnpm test` green; int-spec runs in CI (no local Docker — verify locally via `migration:show` + unit specs).

---

## 5. Validation

- **Architecture:** domain pure (no Nest/TypeORM in `domain/`); app→domain only; repo throws domain exception; capability-resolved port (no concrete adapter dependency). ✅
- **Naming:** `*.port.ts`/`*.entity.ts`/`*.orm-entity.ts`/`*.repository.ts`/`*.tokens.ts`/`*.types.ts`. ✅
- **Contract surface:** new context barrel only adds exports; `CoreCapabilityValues` is additive; new table — no break. Migration ordering guard respected (`1808…`). ✅
- **Security:** no secrets; PII (buyer name/address/tax id) stored only as needed for an issued record (no raw credentials). class-validator DTOs N/A (no HTTP this issue). ✅
- **Testing strategy:** unit (entities/types/repo-mapping) + one CI int-spec (migration round-trip + dedup). Repository coverage per acceptance. ✅
- **Agnosticism:** litmus test — `grep -rin 'nip\|ksef\|vat\|jpk\|faktura' libs/core/src/invoicing` must return zero hits (ADR-026). Add as a self-check during implementation. ✅

## Resolved (post-tech-review + research)
1. **`connectionId` on `InvoiceRecord`** — ✅ part of the design (connection-scoping is structural).
2. **`InvoiceLine` / money** — ✅ `currency` on the command; numeric `unitPriceGross`; neutral `taxRate` string (not `vatRate`); gross/net split deferred.
3. **Country agnosticism** — ✅ standards-aligned neutral vocabulary (ADR-026): scheme-tagged `TaxIdentifier` (not `nip`), open-world `DocumentType`, neutral `RegulatoryStatus` + `clearanceReference`.
4. **Capability mechanism** — ✅ **resolved by research**: regulatory transmission = deferred ADR-002 `RegulatoryTransmitter` sub-capability (method-bearing); doc-type variance = `getSupportedDocumentTypes` discovery. The novel runtime `getCapabilities()` is **rejected**.
5. **Rules-readiness** — ✅ port stays a pure mechanism; `documentType` is command data; no rules engine in #751 (future ECA + specification pattern); the command is the seam.
6. **Fiscal dedup** — ✅ partial UNIQUE `(connectionId, idempotencyKey) WHERE NOT NULL` + `DuplicateInvoiceRecordException`; not `UNIQUE(connectionId, orderId)`.
7. **`orm-entities` sub-barrel** — ✅ deferred until a real cross-context consumer exists.

_No open flags. Ready for the `/pre-implement` gate._
