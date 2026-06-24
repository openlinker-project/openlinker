# FA(3) Schema & Validation Status

> Read this before trusting the FA(3) builder for production use. It records
> what is validated today (C4) and what is deliberately deferred.

## Schema identity

| Field | Value |
|---|---|
| Namespace | `http://crd.gov.pl/wzor/2025/06/25/13775/` |
| Root element | `Faktura` |
| Form code (`KodFormularza`) | `FA` |
| Schema version (`wersjaSchemy`) | `1-0E` |
| Vendored file | [`schemat_fa3_v1-0e.xsd`](./schemat_fa3_v1-0e.xsd) |

## Validation gates

| Gate | Status | Notes |
|---|---|---|
| XML well-formedness | ✓ | via `fast-xml-parser` `XMLValidator` |
| Structural rule set (root + namespace, required sections, line cardinality) | ✓ | JS-based structural check derived from the real XSD; no native XSD engine |
| Authoritative XSD from crd.gov.pl | ✓ | the vendored `.xsd` is now the **authoritative MF FA(3) v1-0E schema** (provenance below) |
| MF example-pack compliance (real Ministry test vectors) | ⏸ deferred (C3+) | belongs to the KSeF submission phase |
| Live KSeF submission / clearance | ⏸ deferred (C3+) | out of scope here |

## Why no full XSD engine (libxmljs)

A native-build XSD validator (`libxmljs` / `libxmljs2`) is intentionally **not** a
dependency: it fails to build on the constrained CI used here. The validator uses
`fast-xml-parser` (already in the workspace, pure JS) for well-formedness plus a
hand-written structural rule set **derived from the vendored XSD** (root +
namespace, `Naglowek` identity attributes, `WariantFormularza`, `Podmiot1`
identification, and the `Fa` body's required children — `KodWaluty`, `P_1`,
`P_2`, `RodzajFaktury`, `Adnotacje`, and ≥1 `FaWiersz`). The vendored XSD is the
provenance/reference artifact; conformance is asserted by the rule set plus the
builder emitting XSD-valid structure.

## Re-fetch checklist (before submission)

1. Confirm the vendored [`schemat_fa3_v1-0e.xsd`](./schemat_fa3_v1-0e.xsd) still
   matches the published `crd.gov.pl` wzór `2025/06/25/13775` (schema `1-0E`).
2. Add MF example-pack fixtures and assert the builder output validates.
3. Run a full XSD-engine validation pass in an environment that can build a
   native validator (CI-external), as a one-off conformance check.

### Vendored XSD provenance

- Source: Ministry of Finance (`crd.gov.pl`), wzór `2025/06/25/13775`, schema
  version `1-0E` (FA(3)).
- SHA-256: `b646b6b525f51adf1bb2545f111fc8ca6e7aa6dd2f98948f1667d3695c06d958`
- Note: the schema `xsd:import`s the MF shared types
  `StrukturyDanych_v10-0E.xsd` (the `etd:` namespace — `TWybor1`, `TWybor1_2`,
  `TNrNIP`, etc.), which is not vendored here; the structural rule set does not
  depend on resolving that import.

Tracking issue: #1148 (FA(3) XML builder); submission/authority follow-up: C3+.
