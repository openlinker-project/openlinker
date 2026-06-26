# FA(3) Implementation Notes

Architecture, mapping tables, and limitations for the FA(3) XML builder
(issue #1148 / C4). All FA(3)/KSeF/NIP/VAT specifics live in this package per
[ADR-026](../../../../../docs/architecture/adrs/026-country-agnostic-invoicing-domain.md);
no PL vocabulary leaks into `libs/core`.

## Architecture

```
IssueInvoiceCommand (neutral, core)
        │
        ▼
Fa3XmlBuilderAdapter            ← neutral→PL mapping seam (this package)
   │  resolveP12()              ← tax-rate mapper
   │  resolveBuyerIdentity()    ← Podmiot2 mapper
   │  resolveKodWaluty()        ← currency mapper
   ▼
Fa3BuilderInput (fully mapped, PL)
        │
        ▼
Fa3WithValidationBuilder (IFa3XmlBuilder)
   │  buildFa3Xml()             ← PURE: object tree → serializeXml (escaped)
   │  validateFa3Xml()          ← structural / well-formedness gate
   ▼
RawFa3Xml (validated)
```

- **Pure builder** (`fa3-xml.builder.ts`): synchronous, no I/O, no `Date.now()`,
  no credentials. Trivially testable with plain fixtures.
- **DOM serialisation** (`xml-dom.builder.ts`): `fast-xml-parser` `XMLBuilder`
  auto-escapes every text/attribute value — the builder NEVER hand-concats XML.
- **Validator** (`fa3-xsd.validator.ts`): structural + well-formedness only; see
  [`schema/SCHEMA_VALIDATION_STATUS.md`](./schema/SCHEMA_VALIDATION_STATUS.md).

## Document layout

| Section | Contents |
|---|---|
| `Naglowek` | `KodFormularza` (FA), `wersjaSchemy` (1-0E), namespace |
| `Podmiot1` | Seller NIP + name + address (from injected `SellerProfile`) |
| `Podmiot2` | Buyer identification choice (see Buyer ID resolution) |
| `Fa` | `KodWaluty`, P_13/P_14/P_15 aggregates, `Adnotacje` (order ref) |
| `FaWiersz` (×N) | One per line: name, quantity, unit price gross, `P_12` |

## P_12 tax-rate mapping (all 10 values)

| Neutral code(s) | FA(3) `P_12` | Net band | Meaning |
|---|---|---|---|
| `23` | `23` | P_13_1 (+P_14_1) | Standard rate 23% |
| `8` | `8` | P_13_2 (+P_14_2) | Reduced rate 8% |
| `5` | `5` | P_13_3 (+P_14_3) | Reduced rate 5% |
| `0-kr` | `0 KR` | P_13_6_1 | 0% domestic |
| `0-wdt` | `0 WDT` | P_13_6_2 | 0% intra-EU supply (WDT) |
| `0-ex` | `0 EX` | P_13_6_3 | 0% export |
| `exempt`, `zw` | `zw` | P_13_7 | Exempt |
| `reverse-charge`, `oo` | `oo` | P_13_10 | Reverse charge (odwrotne obciążenie) |
| `np-i` | `np I` | P_13_8 | Outside PL territory, general |
| `np-ii` | `np II` | P_13_9 | art. 100(1)(4) services taxed in buyer's EU state |

> **NOTE:** KSeF's `TStawkaPodatku` has NO bare `np` token — it splits
> "not applicable / outside scope" into two distinct tokens (`np I`, `np II`)
> that map to two distinct net-base elements (P_13_8 vs P_13_9). Emitting a
> bare `np` is rejected by the schema.

Unknown codes throw `UnmappedTaxRateException` (no silent default).

> **OPEN:** the canonical neutral tax-rate code set (UNCL 5305 vs OpenLinker
> custom) is being settled upstream; the keys above are provisional and must be
> reconciled before C3 submission.

## Buyer ID resolution (`Podmiot2`, mutually exclusive)

1. `pl-nip` → `<NIP>` (10 digits, `NIP_PATTERN`).
2. `eu-vat` (and EU-VAT-shaped schemes) → `<KodUE>` + `<NrVatUE>` (`EU_VAT_PATTERN`).
3. Other foreign scheme → `<KodKraju>` (ISO 3166-1 alpha-2) + `<NrID>`.
4. `taxId === null` (B2C) → `<BrakID>1</BrakID>`.

Malformed identifiers throw `InvalidBuyerIdentificationException` (carries the
neutral scheme + reason only, never the raw value).

## Currency

ISO-4217 → `KodWaluty` against an allow-list (`PLN`/`EUR`/`USD`/`GBP`/`CZK` in
the skeleton). Unsupported currency throws `UnsupportedCurrencyException`.

## Encoding & escaping

- UTF-8 with XML declaration.
- All values escaped by `fast-xml-parser` at serialisation; spec coverage
  includes `<`, `>`, `&`, `"`, `'` in names/addresses.

## Logging / PII

The adapter logs structural facts only (connectionId, orderId, lineCount) via
the shared `Logger`. It NEVER logs buyer names, tax ids, or the raw XML.

## Correction invoices (KOR — #1151 / C7)

A correcting document (`documentType` `corrected`/`credit-note` carrying a neutral
`IssueInvoiceCommand.correction`) builds a `RodzajFaktury=KOR` FA(3) through the
same pure builder + the same C5 session-send flow:

| FA(3) field | Source | Notes |
|---|---|---|
| `RodzajFaktury` | constant `KOR` | plain correction; `KOR_ZAL`/`KOR_ROZ` deferred |
| `TypKorekty` | `2` (default) | line-item correction — the return/refund case |
| `PrzyczynaKorekty` | `correction.reason` | free-text, entity-escaped |
| `DaneFaKorygowanej/DataWystFaKorygowanej` | `correction.originalIssueDate` | original issue date |
| `DaneFaKorygowanej/NrFaKorygowanej` | `correction.originalDocumentNumber` | original number |
| `DaneFaKorygowanej/NrKSeF` = `1` + `NrKSeFFaKorygowanej` | `correction.originalClearanceReference` | KSeF branch is a SEQUENCE — `NrKSeF` is a FLAG (`etd:TWybor1` = `1`), the number goes in `NrKSeFFaKorygowanej` (`tns:TNumerKSeF`). Emitted when the original was a KSeF invoice |
| `DaneFaKorygowanej/NrKSeFN` = `1` | — | when `originalClearanceReference` is `null` (non-KSeF original) |
| `Podmiot1K` / `Podmiot2K` | — (omitted) | XSD nests them in the KOR sequence under `Fa` (siblings of `DaneFaKorygowanej`), both `minOccurs=0`, required only on a party change. OL never tracks party changes → omitted |
| `FaWiersz` (before) | command top-level `lines` | each flagged `StanPrzed=1` |
| `FaWiersz` (after) | `correction.correctedLines` | corrected ("after") line state |
| `P_13_x` / `P_14_x` / `P_15` | after-aggregate **minus** before-aggregate | FA(3) `Fa` annotation mandates the tax-base / tax / total-due fields carry the **difference** (after − before), so they may be negative (`TKwotowy` permits a leading `-`) |

The neutral→FA(3) seam is `mapCorrection` in `fa3-builder-input.mapper.ts`; the
`originalClearanceReference` (the opaque authority reference) is the only linkage
to the original — no KSeF string crosses into core.

> **Reconciled against the vendored authoritative FA(3) v1-0E XSD (#1151
> round-1 review):** the KOR element names/placement (`RodzajFaktury`,
> `TypKorekty`, `DaneFaKorygowanej` with the `NrKSeF` flag + `NrKSeFFaKorygowanej`
> pair, `StanPrzed`) and the signed-difference rule for `P_13_x`/`P_14_x`/`P_15`
> are confirmed against the XSD (choice at lines ~2910-2928; `Fa` annotation at
> ~2441). `Podmiot1K`/`Podmiot2K` are omitted (optional, party-change-only).
> Validation remains *structural* (well-formedness + the hand-written rule set);
> MF example-pack compliance + live KSeF clearance stay deferred to C3+.
> `KOR_ZAL`/`KOR_ROZ` (advance/settlement corrections) are a deferred follow-up.

## Known limitations / deferred work

- ⏸ Reconcile the neutral tax-rate code set (UNCL 5305 vs OpenLinker-custom) —
  the `FA3_TAX_RATE_MAP` keys in `fa3-tax-rate.mapper.ts` are provisional and
  MUST be settled before C3 submission (see the OPEN note under P_12 mapping).
- ⏸ Authoritative XSD from crd.gov.pl + MF example-pack compliance (C3+).
- ⏸ KSeF submission + clearance status (C3+).
- ⏸ `KOR_ZAL` / `KOR_ROZ` advance/settlement-correction document types (#1151 follow-up).
- ⏸ `TypKorekty` selection — currently hard-coded to `2` (line-item correction, the
  return/refund case) in `mapCorrection`. The 1/2/3 period-shift variants
  (`1` = effects in the period of the original, `3` = on terms set by separate
  regulations) are not yet caller-selectable; the neutral `CorrectionReference`
  carries no `typKorekty` field. Deferred until a caller needs a non-default variant.
- ⏸ Per-line GTU / Procedura codes (not in the neutral `InvoiceLine`; sourcing TBD).
- ⏸ Money rounding rule + decimal-place contract (to finalise with the builder).
- ⏸ Emitting OL variant attributes as explicit distinguishing parameters.
