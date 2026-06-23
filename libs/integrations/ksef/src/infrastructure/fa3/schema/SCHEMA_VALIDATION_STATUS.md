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
| XML well-formedness | ✓ C4 | via `fast-xml-parser` `XMLValidator` |
| Structural rule set (root + namespace, required sections, line cardinality) | ✓ C4 | JS-based structural check; no native XSD engine |
| Authoritative XSD from crd.gov.pl | ⏸ deferred (C3+) | the vendored `.xsd` is a **placeholder working copy** — fetch + validate before submission |
| MF example-pack compliance (real Ministry test vectors) | ⏸ deferred (C3+) | belongs to the KSeF submission phase |
| Live KSeF submission / clearance | ⏸ deferred (C3+) | out of scope for C4 |

## Why no full XSD engine (libxmljs) in C4

A native-build XSD validator (`libxmljs`) is intentionally **not** a dependency:
it fails to build on the constrained CI used here, and full XSD authority is a
C3+ concern anyway. C4 uses `fast-xml-parser` (already in the workspace, pure
JS) for well-formedness plus a hand-written structural rule set sized to catch
layout regressions in the builder.

## Re-fetch checklist (before C3 submission)

1. Download the authoritative FA(3) v1-0E XSD from `crd.gov.pl`
   (wzór `2025/06/25/13775`).
2. Replace [`schemat_fa3_v1-0e.xsd`](./schemat_fa3_v1-0e.xsd) and record the
   source URL + fetch date + SHA-256 below.
3. Re-run the validator structural rule set against the real schema; reconcile
   the rule set if the layout diverged.
4. Add MF example-pack fixtures and assert the builder output validates.

### Vendored XSD provenance

- Source URL: _TBD (C3 — placeholder committed in C4)_
- Fetch date: _TBD_
- SHA-256: _TBD_

Tracking issue: #1148 (FA(3) XML builder); submission/authority follow-up: C3+.
