# Implementation Plan: KSeF FA(3) `Platnosc` (payment method, bank account, payment term, skonto)

**Date**: 2026-07-02
**Status**: Draft
**Estimated Effort**: 1.5–2 days
**Issue**: [#1311](https://github.com/openlinker-project/openlinker/issues/1311)

---

## 1. Task Summary

**Objective**: KSeF invoices issued through `libs/integrations/ksef/src/infrastructure/fa3/builders/fa3-xml.builder.ts` never emit the FA(3) `Platnosc` element. Add a per-connection, manually-entered payment configuration (default payment method, bank account, payment term, early-payment discount) and emit it into the FA(3) XML whenever configured.

**Context**: The FA(3) v1-0E schema fully supports `Platnosc` (`minOccurs="0"`, so today's output remains schema-valid), but it is unusual for a real Polish VAT invoice to omit it, and `FA3_IMPLEMENTATION_NOTES.md`'s "Known limitations" section doesn't even flag the gap. This follows directly from the pattern just shipped for inFakt (#1303/#1308): a per-connection default payment method + bank account. Unlike inFakt, KSeF has no live bank-accounts API — this is a config value the operator types in once, not something fetched from a provider.

**Classification**: Integration (KSeF plugin) + Frontend. No CORE changes — this stays entirely inside `libs/integrations/ksef` and the KSeF-specific FE structured section, consistent with ADR-026 (no KSeF/Polish vocabulary crosses into `libs/core`).

---

## 2. Scope & Non-Goals

### In Scope

Five connection-level config values, each independently optional, mapped straight into `Fa/Platnosc`:

| Field | XSD element | Type |
|---|---|---|
| Default payment method | `Platnosc/FormaPlatnosci` | `TFormaPlatnosci` enum (`1`–`7`: Gotówka, Karta, Bon, Czek, Kredyt, Przelew, Mobilna) |
| Bank account number | `Platnosc/RachunekBankowy/NrRB` | string, 10–34 chars |
| Bank name | `Platnosc/RachunekBankowy/NazwaBanku` | string, optional |
| SWIFT | `Platnosc/RachunekBankowy/SWIFT` | string, optional |
| Default payment term (days) | `Platnosc/TerminPlatnosci/TerminOpis` (`Ilosc` + `Jednostka`='dni' + `ZdarzeniePoczatkowe`='data wystawienia faktury') | integer days |
| Early-payment discount (skonto) | `Platnosc/Skonto` (`WarunkiSkonta` + `WysokoscSkonta`) | free text, free text |

Bank account number/name/SWIFT are grouped as one optional `bankAccount` sub-object — a bank account without a method makes no sense, but a method without a bank account (Gotówka) is valid.

### Out of Scope

- `RachunekWlasnyBanku`, `OpisRachunku` (`TRachunekBankowy` sub-fields) — internal bank-side classification / free-text label, no MVP value.
- `RachunekBankowyFaktora` (factoring accounts) — schema supports it, no known operator need.
- `Zaplacono`/`DataZaplaty`, `ZnacznikZaplatyCzesciowej`/`ZaplataCzesciowa`, `LinkDoPlatnosci` — these describe a *specific* invoice's payment state (always blank/false for a new invoice), not a connection default. A connection-level setting has nothing sensible to say about them.
- Multiple `RachunekBankowy` entries (schema allows up to 100, e.g. PLN/EUR accounts) — narrowed to one default account, matching inFakt's single-account model.
- `PlatnoscInna`/`OpisPlatnosci` (the "other, described" payment-method escape hatch) — the 7-value enum already covers the real-world cases; adding a free-text fallback is unnecessary complexity for a config field a human fills in once.
- inFakt's own analogous `days_to_payment`/`payment_date` gap (cross-checked, documented in #1311, filed as its own future follow-up — unrelated to this builder).
- Any change to `libs/core` — no capability port, no `BankAccountsReader`/`BankAccountDefaultSetter` equivalent. KSeF has no live bank-accounts API to back those capabilities.

### Constraints

- Must not change output for existing connections that don't configure payment info (`Platnosc` stays fully absent — no empty/default-guessed values).
- Must preserve the FA(3) XSD-mandated child order inside `Platnosc`: `TerminPlatnosci` → `FormaPlatnosci` → `RachunekBankowy` → `Skonto` (confirmed against the vendored XSD, see §4).
- `Platnosc` itself sits after `FaWiersz` and before the (currently unemitted) `WarunkiTransakcji` in the `Fa` element's schema order (XSD line 3281, confirmed by direct read — sibling of `FaWiersz`, not nested inside it).
- No live picker — this is a plain manually-entered form field set, following the existing `KsefSellerConfig` NIP/name/address precedent, not the inFakt `BankAccountsReader` query-hook pattern.

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/ksef`) + Frontend (`apps/web/src/plugins/ksef`, `apps/web/src/features/connections`)

**Capabilities Involved**: None new. `InvoicingPort`/`RegulatoryTransmitter`/`CorrectionIssuer` (already implemented by `KsefInvoicingAdapter`) are unchanged — this only affects what `mapToFa3BuilderInput` / `buildFa3Xml` render into the document body.

**Existing Services Reused**:
- `KsefAdapterFactory.resolveSeller` / `resolveDefaultTaxRate` pattern — same connection-config-resolution shape reused for `resolvePayment`.
- `Fa3MappingContext` — the existing pure-mapper-context seam gets a new optional field.
- `KsefConnectionConfigShapeValidatorAdapter` — the existing shape-validation seam gets new optional-field checks.
- FE: `edit-connection.schema.ts` + `ksef-seller-config.ts`'s `applyKsefSellerToConfig` assembly-module pattern — mirrored for payment fields.

**New Components Required**:
- `KsefPaymentConfig` type (domain types).
- `Fa3PaymentInput`/`Fa3BankAccount` types + `platnoscNode()` builder function (infrastructure/fa3).
- `apps/web/src/features/connections/components/ksef-payment-config.ts` — flat-field assembly module (mirrors `ksef-seller-config.ts`).
- New `FormField`s in `ksef-structured-section.tsx`.

**Core vs Integration Justification**: This is Integration-only. No CORE port exists (or should exist) for "connection-level manually-entered payment defaults" — CORE's `IssueInvoiceCommand` has no payment-method concept at all (ADR-026: country-agnostic core, PL-specific vocabulary confined to `libs/integrations/ksef`). The resolved payment config flows only through the adapter → mapper → builder chain, never touching a CORE type.

---

## 4. External / Domain Research

### FA(3) XSD facts (verified 2026-07-02 against the vendored `schemat_fa3_v1-0e.xsd`)

- `TFormaPlatnosci` (line 1324): `xsd:integer` restriction, values `1`–`7` (Gotówka, Karta, Bon, Czek, Kredyt, Przelew, Mobilna). **Not a string enum** — the builder must emit an integer-valued string, matching the existing `Fa3TypKorektyValues` precedent (`as const` union of numeric-string literals).
- `TRachunekBankowy` (line 1507): complex type with `NrRB` (required, `TNrRB`, 10–34 chars per pattern), and optional `SWIFT`, `RachunekWlasnyBanku`, `NazwaBanku`, `OpisRachunku`.
- `Fa/Platnosc` (line 3281, `minOccurs="0"`): child sequence, in order —
  1. `choice minOccurs="0"`: `Zaplacono`+`DataZaplaty` OR `ZnacznikZaplatyCzesciowej`+`ZaplataCzesciowa[]` (out of scope, per-invoice facts)
  2. `TerminPlatnosci` (`minOccurs="0" maxOccurs="100"`) — `Termin` (date) and/or `TerminOpis` (`Ilosc`+`Jednostka`+`ZdarzeniePoczatkowe`), both optional within the element but the element must have at least one child in practice
  3. `choice minOccurs="0"`: `FormaPlatnosci` OR `PlatnoscInna`+`OpisPlatnosci`
  4. `RachunekBankowy` (`minOccurs="0" maxOccurs="100"`)
  5. `RachunekBankowyFaktora` (`minOccurs="0" maxOccurs="20"`, out of scope)
  6. `Skonto` (`minOccurs="0"`) — `WarunkiSkonta`+`WysokoscSkonta`, both required within the element if present
  7. `LinkDoPlatnosci` (out of scope)
  8. `IPKSeF` (out of scope)

**This confirms the emit order the builder must use is `TerminPlatnosci → FormaPlatnosci → RachunekBankowy → Skonto`** — NOT the field order listed in the issue body's scope table (which lists payment method first for readability). The plan below uses the correct XSD order.

### Internal patterns (codebase search)

- `KsefConnectionConfig` (`libs/integrations/ksef/src/domain/types/ksef-connection.types.ts`) currently carries `env` + optional `seller` (with its own optional `defaultTaxRate`). The new `payment?: KsefPaymentConfig` field slots in alongside `seller` at the same nesting level.
- `KsefAdapterFactory.resolveSeller` / `.resolveDefaultTaxRate` (`libs/integrations/ksef/src/application/factories/ksef-adapter.factory.ts:108-153`) is the exact precedent for reading an optional connection-config sub-object, validating its shape, and passing a resolved value into the adapter constructor. `resolvePayment` follows the same shape, but — unlike seller/tax-rate — returns `undefined` when nothing is configured (a missing payment config is a valid, common state; a missing seller is a hard failure).
- `Fa3MappingContext` (`fa3-builder-input.mapper.ts:34-55`) is the existing seam for adapter-resolved, connection-scoped values flowing into the pure mapper. `defaultTaxRate: string` (always present) sits next to the new `payment?: Fa3PaymentInput` (optionally present) — the mapper only needs to pass it through.
- `adnotacjeNode()` (`fa3-xml.builder.ts:341-352`) is the precedent for a builder function producing one schema-mandated child block; `platnoscNode()` follows the same shape but is *conditionally* attached to the parent node (only when payment is configured), unlike `Adnotacje` which is always present.
- `Fa3TypKorektyValues` (`fa3-xml.types.ts:100-101`) is the precedent for a numeric-string `as const` union (`'1' | '2' | '3'`) — `Fa3FormaPlatnosciValues` follows the identical shape for `'1'`–`'7'`.
- `KsefConnectionConfigShapeValidatorAdapter` (`libs/integrations/ksef/src/infrastructure/adapters/ksef-connection-config-shape-validator.adapter.ts`) is the precedent for hand-rolled (no class-validator) shape checks on an optional nested config object — `seller.defaultTaxRate`'s optional-string-then-enum-membership check is mirrored for `payment.formaPlatnosci` (enum) and `payment.bankAccount.nrRb` (non-empty-if-bankAccount-present).
- FE: `ksef-seller-config.ts`'s `applyKsefSellerToConfig` is the precedent for a dedicated assembly module shared between the edit-connection schema and (if a create-time KSeF wizard step existed) a setup schema — touches only the payment leaves present on the patch, drops an emptied sub-object rather than persisting a hollow one. `ksef-structured-section.tsx`'s flat `FormField`-per-leaf rendering (no live query hook, `syncStructuredToJson` writer) is the precedent for the new fields; there is no InlineDisclosure wrapper in the current KSeF section (that primitive ships with #1308, still unmerged at plan time — see §5 Open Questions).

No external-system research needed (no new HTTP calls, no new auth flow — this is a local config-to-XML mapping change).

---

## 5. Questions & Assumptions

### Open Questions

- **`InlineDisclosure` availability**: the issue's design mockup describes wrapping the new fields in an `InlineDisclosure` (the primitive introduced by #1308, `apps/web/src/shared/ui/inline-disclosure.tsx`). At plan time #1308 is still an open PR. If it has merged by the time this issue is implemented, wrap the new fields in `InlineDisclosure` (mirroring `infakt-structured-section.tsx`); if not yet merged, add the fields as plain `FormField`s appended to the existing flat list in `ksef-structured-section.tsx` (no disclosure wrapper) and revisit the wrapping in a follow-up once the primitive lands. This plan's FE step is written to work either way.
- **Payment-term "days" representation**: `TerminOpis` requires `Ilosc` (integer) + `Jednostka` (free text, e.g. `'dni'`) + `ZdarzeniePoczatkowe` (free text, e.g. `'data wystawienia faktury'`). The plan hardcodes `Jednostka='dni'` and `ZdarzeniePoczatkowe='data wystawienia faktury'` (mirroring the `adnotacjeNode()` precedent of hardcoding the common/only-supported case) and only exposes the day count as a config field. If an operator ever needs a different starting event, that's a follow-up.

### Assumptions

- The bank account is a **manually-entered, per-connection config value**, not live-fetched — confirmed no KSeF/FA(3) API exists to list bank accounts.
- `Platnosc` is omitted entirely when no payment info is configured — never emitted with guessed/empty values, so existing connections keep byte-identical output.
- `TerminPlatnosci`, `FormaPlatnosci`, `RachunekBankowy`, and `Skonto` are each independently optional within `Platnosc` — a Gotówka connection can still set a payment term; a connection can set a bank account without a payment method (unusual but not rejected, since `FormaPlatnosci` is itself `minOccurs="0"` in the choice).
- A configured `bankAccount` always requires at minimum `nrRb` (non-empty) — `bankName`/`swift` are optional sub-fields, matching the XSD's own `NrRB`-required-others-optional shape.
- Emitting `RachunekBankowyFaktora` is out of scope (no operator need identified).

### Documentation Gaps

None — the vendored XSD and existing FA(3) builder code were sufficient; no external MF documentation was needed beyond what's already vendored in-repo.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain types

**Goal**: Define the neutral (adapter-internal) shapes for the new config and builder-input fields.

**Steps**:

1. **Add `KsefPaymentConfig` to connection types**
   - **File**: `libs/integrations/ksef/src/domain/types/ksef-connection.types.ts`
   - **Action**: Add
     ```typescript
     export const KsefFormaPlatnosciValues = ['1', '2', '3', '4', '5', '6', '7'] as const;
     export type KsefFormaPlatnosci = (typeof KsefFormaPlatnosciValues)[number];

     export interface KsefBankAccountConfig {
       nrRb: string;
       bankName?: string;
       swift?: string;
     }

     export interface KsefPaymentConfig {
       formaPlatnosci?: KsefFormaPlatnosci;
       bankAccount?: KsefBankAccountConfig;
       paymentTermDays?: number;
       skonto?: { conditions: string; amount: string };
     }
     ```
     Add `payment?: KsefPaymentConfig` to `KsefConnectionConfig`, alongside the existing `seller?: KsefSellerConfig`.
   - **Acceptance**: `pnpm --filter @openlinker/integrations-ksef type-check` passes; existing `KsefConnectionConfig` consumers unaffected (optional field, additive).
   - **Dependencies**: None.

2. **Add FA(3) payment-node types**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-schema.types.ts`
   - **Action**: Add `Fa3FormaPlatnosciValues = ['1','2','3','4','5','6','7'] as const;` + `Fa3FormaPlatnosci` type, following the `Fa3TypKorektyValues` precedent (numeric-string union, documented with the same Gotówka/Karta/.../Mobilna table as the XSD annotation).
   - **Acceptance**: Type compiles; values match the XSD's `TFormaPlatnosci` enumeration exactly (cross-checked against schema line 1324 in the doc comment, same style as the existing `Fa3P12Values` doc comment).
   - **Dependencies**: None.

3. **Add `Fa3PaymentInput` builder-input type**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-xml.types.ts`
   - **Action**: Add
     ```typescript
     export interface Fa3BankAccount {
       nrRb: string;
       bankName?: string;
       swift?: string;
     }

     export interface Fa3PaymentInput {
       formaPlatnosci?: Fa3FormaPlatnosci;
       bankAccount?: Fa3BankAccount;
       paymentTermDays?: number;
       skonto?: { conditions: string; amount: string };
     }
     ```
     Add `payment?: Fa3PaymentInput` to `Fa3BuilderInput`. Import `Fa3FormaPlatnosci` from `./fa3-schema.types`.
   - **Acceptance**: Type compiles; `Fa3BuilderInput` remains backward-compatible (new field optional) so every existing builder test that constructs an input without `payment` still compiles.
   - **Dependencies**: Step 2.

### Phase 2: Pure builder — emit `Platnosc`

**Goal**: `buildFa3Xml` emits a schema-ordered `Platnosc` element when `input.payment` is present, and omits it entirely otherwise.

**Steps**:

4. **Add `platnoscNode()` to the builder**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/builders/fa3-xml.builder.ts`
   - **Action**: Add a function mirroring `adnotacjeNode()`'s style but building conditionally:
     ```typescript
     /**
      * The optional `Platnosc` block (XSD line ~3281, sibling of `FaWiersz` under
      * `Fa`). Child order is XSD-mandated: TerminPlatnosci, FormaPlatnosci,
      * RachunekBankowy, Skonto (verified against the vendored FA(3) v1-0E XSD —
      * NOT payment-method-first, despite that being the more intuitive reading
      * order). Returns `undefined` when nothing is configured so `faNode` can
      * omit the element entirely rather than emit an empty one.
      */
     function platnoscNode(payment: Fa3PaymentInput | undefined): XmlNodeObject | undefined {
       if (payment === undefined) {
         return undefined;
       }
       const node: XmlNodeObject = {};
       if (payment.paymentTermDays !== undefined) {
         node.TerminPlatnosci = {
           TerminOpis: {
             Ilosc: payment.paymentTermDays,
             Jednostka: 'dni',
             ZdarzeniePoczatkowe: 'data wystawienia faktury',
           },
         };
       }
       if (payment.formaPlatnosci !== undefined) {
         node.FormaPlatnosci = payment.formaPlatnosci;
       }
       if (payment.bankAccount !== undefined) {
         const rachunek: XmlNodeObject = { NrRB: payment.bankAccount.nrRb };
         if (payment.bankAccount.bankName !== undefined) {
           rachunek.NazwaBanku = payment.bankAccount.bankName;
         }
         if (payment.bankAccount.swift !== undefined) {
           rachunek.SWIFT = payment.bankAccount.swift;
         }
         node.RachunekBankowy = rachunek;
       }
       if (payment.skonto !== undefined) {
         node.Skonto = {
           WarunkiSkonta: payment.skonto.conditions,
           WysokoscSkonta: payment.skonto.amount,
         };
       }
       return Object.keys(node).length > 0 ? node : undefined;
     }
     ```
   - **Acceptance**: Given `payment: { formaPlatnosci: '6', bankAccount: { nrRb: '...' } }`, produces `{ FormaPlatnosci: '6', RachunekBankowy: { NrRB: '...' } }` in that key order; given `payment: undefined`, returns `undefined`.
   - **Dependencies**: Phase 1 step 3. Import `Fa3PaymentInput` in the builder's type-only import block.

5. **Wire `platnoscNode()` into `faNode()`**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/builders/fa3-xml.builder.ts`
   - **Action**: In `faNode()`, after `node.FaWiersz = wiersze;`, add:
     ```typescript
     const platnosc = platnoscNode(input.payment);
     if (platnosc !== undefined) {
       node.Platnosc = platnosc;
     }
     return node;
     ```
     Placement matters: `Platnosc` is a sibling of `FaWiersz`, emitted immediately after it (XSD line 3281, confirmed after `FaWiersz`'s closing at line ~3078-3280 and before `WarunkiTransakcji` at line 3441 — neither of which the builder emits, so `Platnosc` is simply the new last key on `node`).
   - **Acceptance**: A round-trip test (see Phase 4) confirms element order in the serialised XML.
   - **Dependencies**: Step 4.

### Phase 3: Mapper + adapter + factory wiring

**Goal**: Connection config → adapter → mapper context → builder input, following the exact `resolveSeller`/`defaultTaxRate` precedent chain.

**Steps**:

6. **Extend `Fa3MappingContext` + `mapToFa3BuilderInput`**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-builder-input.mapper.ts`
   - **Action**: Add `payment?: Fa3PaymentInput;` to `Fa3MappingContext` (doc comment: "Resolved connection-level payment defaults (#1311); `undefined` when the connection has none configured — the builder omits `Platnosc` entirely in that case."). In `mapToFa3BuilderInput`, add `...(context.payment !== undefined ? { payment: context.payment } : {}),` to the returned object (mirrors the existing conditional-spread style already used for `correction`).
   - **Acceptance**: `fa3-builder-input.mapper.spec.ts` — new case: context with `payment` set produces `Fa3BuilderInput.payment` populated; context without it produces no `payment` key at all (not `payment: undefined`, to keep `faNode`'s `input.payment === undefined` check clean either way — an explicit `undefined` value also satisfies that check, but omitting the key entirely is more consistent with the mapper's existing conditional-spread style for `correction`).
   - **Dependencies**: Phase 1 step 3.

7. **Resolve payment config in `KsefAdapterFactory`**
   - **File**: `libs/integrations/ksef/src/application/factories/ksef-adapter.factory.ts`
   - **Action**: Add a `resolvePayment(connection): Fa3PaymentInput | undefined` method mirroring `resolveSeller`'s shape but permissive (no throw — payment is optional, unlike seller):
     ```typescript
     private resolvePayment(connection: Connection): Fa3PaymentInput | undefined {
       const config = connection.config as Partial<KsefConnectionConfig> | undefined;
       const payment = config?.payment;
       if (!payment || Object.keys(payment).length === 0) {
         return undefined;
       }
       const result: Fa3PaymentInput = {};
       if (payment.formaPlatnosci !== undefined) {
         result.formaPlatnosci = payment.formaPlatnosci;
       }
       if (payment.bankAccount?.nrRb) {
         result.bankAccount = {
           nrRb: payment.bankAccount.nrRb,
           ...(payment.bankAccount.bankName ? { bankName: payment.bankAccount.bankName } : {}),
           ...(payment.bankAccount.swift ? { swift: payment.bankAccount.swift } : {}),
         };
       }
       if (payment.paymentTermDays !== undefined) {
         result.paymentTermDays = payment.paymentTermDays;
       }
       if (payment.skonto?.conditions && payment.skonto?.amount) {
         result.skonto = payment.skonto;
       }
       return Object.keys(result).length > 0 ? result : undefined;
     }
     ```
     Call `const payment = this.resolvePayment(connection);` alongside the existing `seller`/`defaultTaxRate` resolution, and thread it through to the `KsefInvoicingAdapter` constructor call (step 8) instead of into `Fa3MappingContext` directly — the adapter, not the factory, builds the mapping context per-invoice (matching how `seller`/`defaultTaxRate` already flow: factory → adapter constructor → adapter's `issueInvoice` builds the context).
   - **Acceptance**: A connection with a well-formed `config.payment.bankAccount.nrRb` (non-empty) resolves; a connection with `bankAccount: { nrRb: '' }` drops the malformed bank account but keeps any other configured payment fields (defensive - shape validator should have caught this at save time, but the factory doesn't trust it blindly, same posture as `resolveDefaultTaxRate`'s defensive `.trim() ||` fallback).
   - **Dependencies**: Phase 1 steps 1 & 3.

8. **Thread `payment` through `KsefInvoicingAdapter`**
   - **File**: `libs/integrations/ksef/src/infrastructure/adapters/ksef-invoicing.adapter.ts`
   - **Action**: Add `private readonly payment: Fa3PaymentInput | undefined,` as a new constructor parameter (after `defaultTaxRate`, before `now`, following the existing parameter-ordering-by-recency convention). In `issueInvoice`, add `payment: this.payment,` to the `mapToFa3BuilderInput` context object (conditionally spread only if defined, matching the mapper's own style — or simply always pass `this.payment` since it's already `| undefined` and the mapper's conditional-spread already handles an `undefined` value correctly).
   - **Acceptance**: `ksef-invoicing.adapter.spec.ts` — new case: adapter constructed with a `payment` value produces a built XML containing `Platnosc`; adapter constructed with `payment: undefined` (the default for all existing tests, which won't pass the new constructor arg — need to check whether the constructor arg is required or should default to `undefined`) produces no `Platnosc`. To avoid breaking every existing test call site that constructs `KsefInvoicingAdapter` positionally, give the new parameter a default: `private readonly payment: Fa3PaymentInput | undefined = undefined,`.
   - **Dependencies**: Steps 6, 7.

9. **Update `KsefAdapterFactory.createAdapters`**
   - **File**: `libs/integrations/ksef/src/application/factories/ksef-adapter.factory.ts`
   - **Action**: Pass `payment` as the new argument to `new KsefInvoicingAdapter(connection.id, httpClient, sessionCrypto, fa3Builder, seller, defaultTaxRate, payment)`.
   - **Acceptance**: `ksef-adapter.factory.spec.ts` (if one exists — verify during implementation; if not, add a focused case) confirms a connection with `config.payment` set constructs an adapter whose issued XML carries `Platnosc`.
   - **Dependencies**: Steps 7, 8.

### Phase 4: Shape validation

**Goal**: Reject a malformed `config.payment` at connection-save time (400), mirroring the existing `seller.defaultTaxRate` check.

**Steps**:

10. **Extend `KsefConnectionConfigShapeValidatorAdapter`**
    - **File**: `libs/integrations/ksef/src/infrastructure/adapters/ksef-connection-config-shape-validator.adapter.ts`
    - **Action**: Add, after the existing `seller` block:
      ```typescript
      const payment = config.payment;
      if (payment !== undefined && payment !== null && typeof payment === 'object') {
        const p = payment as Record<string, unknown>;
        if (p.formaPlatnosci !== undefined) {
          if (typeof p.formaPlatnosci !== 'string' || !(KsefFormaPlatnosciValues as readonly string[]).includes(p.formaPlatnosci)) {
            issues.push({ path: 'payment.formaPlatnosci', message: `must be one of: ${KsefFormaPlatnosciValues.join(', ')}` });
          }
        }
        if (p.bankAccount !== undefined && p.bankAccount !== null && typeof p.bankAccount === 'object') {
          const nrRb = (p.bankAccount as Record<string, unknown>).nrRb;
          if (typeof nrRb !== 'string' || nrRb.trim().length === 0) {
            issues.push({ path: 'payment.bankAccount.nrRb', message: 'must be a non-empty string when bankAccount is set' });
          }
        }
        if (p.paymentTermDays !== undefined && (typeof p.paymentTermDays !== 'number' || p.paymentTermDays < 0 || !Number.isInteger(p.paymentTermDays))) {
          issues.push({ path: 'payment.paymentTermDays', message: 'must be a non-negative integer' });
        }
      }
      ```
    - **Acceptance**: `ksef-connection-config-shape-validator.adapter.spec.ts` (verify file name during implementation) — new cases: valid payment config passes; `formaPlatnosci: '9'` rejected; `bankAccount: { nrRb: '' }` rejected; `paymentTermDays: -1` rejected; a connection with no `payment` key at all still passes (backward compatible).
    - **Dependencies**: Phase 1 step 1 (import `KsefFormaPlatnosciValues`).

### Phase 5: Frontend

**Goal**: Expose the new fields on the KSeF structured-config section, following the existing flat-`FormField` + `syncStructuredToJson` pattern (and `InlineDisclosure` if #1308 has merged by implementation time — see §5 Open Questions).

**Steps**:

11. **Add a payment-config assembly module**
    - **File**: `apps/web/src/features/connections/components/ksef-payment-config.ts` (new)
    - **Action**: Mirror `ksef-seller-config.ts`'s shape:
      ```typescript
      export interface KsefPaymentInput {
        paymentFormaPlatnosci?: string;
        paymentBankAccountNrRb?: string;
        paymentBankAccountBankName?: string;
        paymentBankAccountSwift?: string;
        paymentTermDays?: string; // form input as string; parsed at assembly
        paymentSkontoConditions?: string;
        paymentSkontoAmount?: string;
      }

      export function applyKsefPaymentToConfig(
        config: Record<string, unknown>,
        input: Partial<KsefPaymentInput>,
      ): Record<string, unknown> { /* touches only leaves present on `input`, drops emptied sub-objects */ }
      ```
      Follow `applyKsefSellerToConfig`'s exact "touch only present leaves, drop hollow objects" contract so the edit path's per-field sync doesn't clobber untouched siblings.
    - **Acceptance**: Unit test (new `ksef-payment-config.test.ts`) — setting only `paymentFormaPlatnosci` on an empty config produces `{ payment: { formaPlatnosci: '6' } }`; clearing the only configured field drops `payment` entirely; setting `paymentBankAccountNrRb` alone (no method) still assembles a `bankAccount` sub-object without requiring `formaPlatnosci`.
    - **Dependencies**: None (pure FE module, no backend dependency for this step itself).

12. **Wire the assembly module into `edit-connection.schema.ts`**
    - **File**: `apps/web/src/features/connections/components/edit-connection.schema.ts`
    - **Action**: Add the 7 flat `KsefPaymentInput` fields to the structured-schema shape (following the existing `ksefEnvironment`/`sellerNip` optional-field style), and call `applyKsefPaymentToConfig` alongside the existing `applyKsefSellerToConfig` call when assembling the config patch.
    - **Acceptance**: Existing `edit-connection.schema` tests still pass; new cases cover round-tripping the payment fields through parse → assemble → re-read.
    - **Dependencies**: Step 11.

13. **Add fields to `ksef-structured-section.tsx`**
    - **File**: `apps/web/src/plugins/ksef/components/ksef-structured-section.tsx`
    - **Action**: Append `FormField`s for the 7 flat fields after the existing "Context identifier" field, each wired via `form.watch(...)` / `syncStructuredToJson(...)` exactly like the existing seller fields. A `Select` for payment method (7 `KsefFormaPlatnosciValues` options with Polish labels — Gotówka/Karta/Bon/Czek/Kredyt/Przelew/Mobilna); plain `Input`s for the rest. If `InlineDisclosure` is available at implementation time, wrap the block (mirroring `infakt-structured-section.tsx`); otherwise leave as a flat continuation of the existing list. Each field's `description` prop credits its FA(3) target element (e.g. "Emitted as `Platnosc/TerminPlatnosci/TerminOpis`"), matching the mockup's copy at `docs/plans/mockups/infakt-ksef-bank-account-payment-terms.html`.
    - **Acceptance**: Component test (extend the existing KSeF structured-section test, or add one if none exists) — renders all 7 fields; typing in each calls `syncStructuredToJson` with the right key.
    - **Dependencies**: Steps 11, 12.

14. **Update `FA3_IMPLEMENTATION_NOTES.md`**
    - **File**: `libs/integrations/ksef/src/infrastructure/fa3/FA3_IMPLEMENTATION_NOTES.md`
    - **Action**: Add a `Platnosc` row/section to the field-mapping table (mirroring the existing KOR mapping table's style), and remove/annotate the implicit gap — document the emit order (`TerminPlatnosci → FormaPlatnosci → RachunekBankowy → Skonto`) and the deliberately-out-of-scope fields, so a future reader doesn't reintroduce a `RachunekBankowyFaktora` or `Zaplacono` "fix" without re-reading this reasoning.
    - **Acceptance**: Doc updated; no code change.
    - **Dependencies**: Phase 2–4 complete (documents the shipped behavior, not the plan).

### Phase 6: Smoke test + verification artifact

**Goal**: Prove the shipped feature actually works end-to-end in a running app, and that the FE matches the design mockup — not just that unit tests pass in isolation. This is the same live-verification discipline used for the inFakt bank-account picker (#1308): start the real dev stack, drive the feature through the browser, and capture the evidence rather than asserting success from code review alone.

**Steps**:

15. **Live smoke test against a running KSeF connection**
    - **Action**: Start the dev stack (`pnpm dev:stack:up`, `pnpm start:dev:api`, `pnpm start:dev:web`). Against a real (sandbox/test-environment) KSeF connection: (a) open the connection's edit screen and confirm the new payment fields render per Phase 5; (b) set a Przelew method + bank account + payment term + skonto, save, and confirm the connection config persists correctly; (c) switch to Gotówka and confirm the bank/term/skonto fields behave as designed (per the mockup's collapse behavior, if `InlineDisclosure` shipped) or simply remain independently editable (if not); (d) issue a real invoice on the payment-configured connection and pull the resulting FA(3) XML to confirm `Platnosc` is present with the expected sub-elements in the correct order; (e) issue an invoice on an unconfigured connection and confirm `Platnosc` is absent (regression check).
    - **Acceptance**: All five checks pass against the running app, not just unit tests.
    - **Dependencies**: Phases 1–5 complete and deployed to the local dev stack.

16. **Produce a verification artifact with screenshots**
    - **Action**: Capture screenshots of each state exercised in step 15 (edit-screen empty state, Przelew fully filled, Gotówka collapsed/independent state, the resulting invoice XML or its rendered detail view showing payment info) using the same throwaway-edit-then-revert Playwright screenshot pattern established for the inFakt artifact (`docs/plans/mockups/infakt-ksef-bank-account-payment-terms.html`'s screenshots). Build an Artifact (HTML) placing each screenshot side-by-side with the corresponding mockup state, so a reviewer can visually confirm the shipped UI matches the design reference field-for-field (labels, order, description copy) rather than taking it on faith.
    - **Acceptance**: Artifact published and linked from the PR description; every mockup state has a corresponding real-screenshot counterpart with no visible mismatch (or mismatches explicitly called out and justified).
    - **Dependencies**: Step 15.

### Implementation Details

**New Components**:
- **Domain (Integration)**: `KsefPaymentConfig`/`KsefBankAccountConfig`/`KsefFormaPlatnosciValues` (`ksef-connection.types.ts`); `Fa3PaymentInput`/`Fa3BankAccount` (`fa3-xml.types.ts`); `Fa3FormaPlatnosciValues` (`fa3-schema.types.ts`).
- **Infrastructure**: `platnoscNode()` builder function; `KsefAdapterFactory.resolvePayment`; shape-validator additions.
- **Frontend**: `ksef-payment-config.ts` assembly module; new `FormField`s in `ksef-structured-section.tsx`.

**Configuration Changes**: None (no env vars). Connection `config.payment` is a new optional JSONB sub-object on the existing `connections.config` column — no migration needed (JSONB is schemaless at the DB layer).

**Database Migrations**: None.

**Events**: None emitted or consumed — this is a pure mapping change inside the existing issuance path.

**Error Handling**: New `InvalidConnectionConfigException` issues (via the existing shape-validator seam) for a malformed `payment.formaPlatnosci` / `payment.bankAccount.nrRb` / `payment.paymentTermDays`. No new exception types — reuses the existing `FlatValidationIssue`/`InvalidConnectionConfigException` machinery.

---

## 7. Alternatives Considered

### Alternative 1: Model this as a `BankAccountsReader`/`BankAccountDefaultSetter` capability (the inFakt pattern)

- **Description**: Give KSeF the same CORE capability ports inFakt uses, with a live-picker FE flow.
- **Why Rejected**: Those capabilities model "the provider has its own list of bank accounts we can read and mutate via API." KSeF/FA(3) has no such API — the bank account is purely a fact the taxpayer's own accounting system knows and types into the invoice. Building a capability port with no second real implementation (today) and no provider API to back it would be a speculative CORE abstraction, violating the "prefer existing patterns, no unnecessary abstractions" rule.
- **Trade-offs**: The chosen approach (plain config field) means no live validation that the account number is real or "the" default — but that's correct, since KSeF doesn't have a concept of "the default account" at all; it's OpenLinker's own connection-level default.

### Alternative 2: Emit `Platnosc` with per-invoice overrides sourced from a future order-level payment signal

- **Description**: Wait for core to grow an order-level "how was this paid" concept, then let each invoice look up its own payment method instead of a connection default.
- **Why Rejected**: No such core signal exists today (documented in #1311's "why connection-level" reasoning), and speculatively designing for it now would be over-engineering. The per-invoice path is a natural additive follow-up if/when core grows that signal — the connection-level default doesn't block it.
- **Trade-offs**: Every invoice on a connection gets the same payment info regardless of how that specific order was actually paid — acceptable for MVP, matches the already-shipped inFakt precedent.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ All new code lives in `libs/integrations/ksef` (domain/infrastructure) and `apps/web` (FE) — no CORE changes, matching ADR-026's country-agnostic-core mandate.
- ✅ `KsefInvoicingAdapter` continues to implement `InvoicingPort`/`RegulatoryTransmitter`/`RegulatoryDocumentReader`/`CorrectionIssuer` unchanged — no port surface change.

### Naming Conventions
- ✅ `*.types.ts` for new types, `as const` + union pattern for `KsefFormaPlatnosciValues`/`Fa3FormaPlatnosciValues` (no TS enum), matching `Fa3TypKorektyValues` precedent.
- ✅ FE: `*-config.ts` assembly module naming matches `ksef-seller-config.ts`; `*.test.ts` co-located.

### Existing Patterns
- ✅ Factory-resolves-from-connection-config → adapter-constructor-injection → mapper-context → pure-builder chain is identical in shape to the existing `seller`/`defaultTaxRate` path — no new wiring pattern introduced.
- ✅ Builder function (`platnoscNode`) follows `adnotacjeNode()`'s style (pure, returns an `XmlNodeObject`), the only difference being conditional presence (`undefined` when nothing configured) vs. `adnotacjeNode()`'s always-present block.

### Risks / Edge Cases
- **XSD child order** is easy to get wrong by intuition (payment-method-first reads naturally, but the XSD mandates `TerminPlatnosci` first) — mitigated by Phase 2's explicit order and a round-trip XSD-validation test (Phase 9 below) rather than trusting hand-verification alone.
- **Constructor-arg backward compatibility**: adding a required positional constructor param to `KsefInvoicingAdapter` would break every existing test call site. Mitigated by defaulting the new param to `undefined` (Phase 3 step 8).
- **Partial payment config** (e.g. `bankAccount` set without `formaPlatnosci`): the XSD permits this (both are independently `minOccurs="0"` within `Platnosc`), so the builder must not require one to emit the other. Explicitly covered by builder unit tests.
- **No backward-compat concern for existing connections**: `payment` is a wholly new optional key; connections saved before this change have no `config.payment` and continue producing byte-identical `Platnosc`-free XML.
- **#1308/`InlineDisclosure` merge-order dependency** (FE-only, cosmetic): flagged in §5; the plan degrades gracefully to a flat field list if implemented before #1308 merges.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `fa3-xml.builder.spec.ts`: `platnoscNode` / `buildFa3Xml` — (a) no `Platnosc` when `input.payment` undefined; (b) full `Platnosc` with all 4 sub-blocks in correct XSD order when everything is configured; (c) `FormaPlatnosci`-only (Gotówka, no bank account); (d) `bankAccount`-only (no method); (e) `paymentTermDays`-only; (f) `skonto`-only.
- `fa3-builder-input.mapper.spec.ts`: context with/without `payment` maps correctly onto `Fa3BuilderInput.payment`.
- `ksef-invoicing.adapter.spec.ts`: adapter constructed with a `payment` value produces XML containing `Platnosc`; constructed without it (default `undefined`) produces none.
- `ksef-adapter.factory` tests (new or extended): `resolvePayment` — well-formed config resolves; malformed `bankAccount.nrRb: ''` is dropped defensively; empty `payment: {}` resolves to `undefined`.
- `ksef-connection-config-shape-validator.adapter.spec.ts`: new cases per Phase 4 step 10's acceptance criteria.
- FE: `ksef-payment-config.test.ts` (new), `edit-connection.schema` tests extended, `ksef-structured-section` component test extended (or added).

### Integration Tests
- Not required — no new HTTP calls, no new DB schema, no cross-service interaction. The existing KSeF issuance integration test (if any covers full XML round-trip against the XSD validator) should be extended with one payment-configured case to confirm the generated document still validates against `schemat_fa3_v1-0e.xsd` end-to-end (this is the one meaningful integration-level check: schema validity of the new element, not a new integration boundary).

### Mock vs Real Adapters
- Unit tests mock nothing external — `buildFa3Xml` is pure, `KsefAdapterFactory`/`KsefInvoicingAdapter` tests use in-memory `Connection` fixtures, matching existing KSeF test conventions.

### Acceptance Criteria (mirrors issue #1311)
- [ ] `KsefConnectionConfig` carries an optional `payment` section (method, bank account, term, skonto).
- [ ] `fa3-xml.builder.ts` emits a valid `Platnosc` element with only the configured sub-elements, in XSD-mandated child order.
- [ ] No `Platnosc` element emitted when nothing is configured (existing connections unaffected).
- [ ] Emitted XML validates against `schemat_fa3_v1-0e.xsd` for both the with-payment and without-payment cases.
- [ ] `ksef-structured-section.tsx` exposes the new fields, matching the mockup's field order and copy.
- [ ] `docs/plans/mockups/infakt-ksef-bank-account-payment-terms.html` committed (done as part of this plan).
- [ ] `FA3_IMPLEMENTATION_NOTES.md` updated.
- [ ] Tests added per the strategy above.
- [ ] No CORE ↔ Integration boundary violations.
- [ ] Live smoke test against a running dev-stack KSeF connection performed (Phase 6, step 15).
- [ ] Verification artifact with side-by-side mockup/real-screenshot comparisons published and linked from the PR (Phase 6, step 16).

---

## 10. Final Alignment Checklist

- [x] Follows hexagonal architecture — all changes confined to the KSeF integration package + its FE plugin section.
- [x] Respects CORE vs Integration boundaries — no CORE types, ports, or services touched.
- [x] Uses existing patterns — factory/adapter/mapper/builder chain and shape-validator mirror the shipped `seller`/`defaultTaxRate` precedent exactly; no new abstraction invented.
- [x] Idempotency considered — `buildFa3Xml` remains pure; no state, no retries introduced.
- [ ] Event-driven patterns — N/A, no events involved.
- [ ] Rate limits & retries — N/A, no new HTTP calls.
- [x] Error handling comprehensive — shape-validator rejects malformed config at save time; factory defensively drops malformed sub-fields at resolve time (belt-and-suspenders, matching `resolveDefaultTaxRate`'s posture).
- [x] Testing strategy complete — unit coverage across mapper/builder/adapter/factory/validator/FE; one integration-level XSD-validation check.
- [x] Naming conventions followed.
- [x] File structure matches standards.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.
- [ ] Live smoke test + verification artifact produced before the PR is un-drafted/merged (Phase 6).
