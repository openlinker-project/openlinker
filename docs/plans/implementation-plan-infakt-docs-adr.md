# Implementation Plan: inFakt ADR + operator setup guide (#1283)

**Date**: 2026-07-02
**Status**: Ready for Review
**Estimated Effort**: 3-4 hours

---

## Retarget addendum (2026-07-06)

The plan below was written against a stacked-branch layout that no longer holds:
PR #1307 now targets `main` directly rather than `1282-infakt-fe-plugin`, and its
prerequisites (#1281, #1282, #1309, #1310) have all merged. The PR's diff also grew
four screenshots (`06`-`07`, wizard/edit-form payment-method + bank-picker shots)
that this plan's original "no new screenshots" constraint did not anticipate - both
came from documenting features that landed after this plan was written. Constraints
below are historical context, not current scope.

---

## 1. Task Summary

**Objective**: Document the architectural decision behind inFakt's KSeF-intermediary
model as an ADR, write an operator-facing setup guide, add the package README the
`@openlinker/integrations-infakt` package is missing, and update
`docs/architecture-overview.md` + the ADR index to reference both.

**Context**: inFakt (epic #1279) is the second provider of the country-agnostic
Invoicing domain (ADR-026). Its KSeF model differs from both direct KSeF
(`@openlinker/integrations-ksef`, OL owns the session) and Subiekt (local bridge
auto-submits) — inFakt auto-submits to KSeF on its own via its own REST API, so OL
only ever *reads* clearance status. That's a non-obvious, easy-to-misdesign-around
decision, which is exactly what ADR-030 exists to pin down for future maintainers.

**Classification**: Documentation.

---

## 2. Scope & Non-Goals

### In Scope
- `docs/architecture/adrs/030-infakt-ksef-indirection.md` (Status: Accepted — the
  decision already shipped across #1275/#1292/#1293, so this is retrospective).
- ADR index row in `docs/architecture/adrs/README.md`.
- `docs/integrations/infakt/setup-guide.md` — prerequisites, connection creation,
  webhook configuration (URL, HMAC secret, verification handshake), verification
  walkthrough, troubleshooting. Illustrated with the 20 real screenshots already
  captured on `1282-infakt-fe-plugin` (PR #1300) at
  `libs/integrations/infakt/docs/assets/`.
- `libs/integrations/infakt/README.md` — adapter key, capabilities, credentials/config
  shape, notable implementation details, doc links (mirrors the Erli/DPD/AI READMEs
  from PR #1284).
- `docs/architecture-overview.md` § 14 Invoicing — new "Second provider" paragraph for
  inFakt, alongside the existing KSeF paragraph.

### Out of Scope
- Any code change to the inFakt adapter, plugin, or FE — this issue is docs-only. The
  backend (#1280/#1281) and FE (#1282) land in their own PRs.
- New screenshots — the 20 images captured for PR #1300's E2E walkthrough already
  cover every UI state this guide needs (wizard, connection test, orders, invoice
  issuance/clearance, correction flow) plus the inFakt-dashboard side (login, API key
  page, webhooks list, webhook subscription form, invoice-confirmed).

### Constraints
- This branch is stacked on `1282-infakt-fe-plugin` (not `main`) because the setup
  guide documents connection-wizard fields and webhook wiring that only exist on that
  branch — #1281's registration/webhook work and #1282's FE plugin are still open PRs.
  The PR for this issue targets `1282-infakt-fe-plugin` as its base so the diff stays
  docs-only; it re-targets `main` automatically once that branch merges.

---

## 3. Architecture Mapping

**Target Layer**: Documentation (no code layer touched).

**Capabilities Involved**: `Invoicing`, `RegulatoryStatusReader`, `CorrectionIssuer` —
described, not implemented, in this issue.

**Existing Services Reused**: None (docs-only).

**New Components Required**: None (docs-only).

**Core vs Integration Justification**: N/A — no code changes.

---

## 4. External / Domain Research

### Internal Patterns
- **ADR template & conventions**: `docs/architecture/adrs/template.md` +
  `docs/architecture/adrs/README.md` (numbering, status taxonomy, retrospective-author
  convention, <500-word discipline).
- **Closest ADR precedent**: ADR-026 (country-agnostic invoicing domain) for the
  capability-decomposition vocabulary (`RegulatoryTransmitter` /
  `RegulatoryStatusReader`), and its "Amendment" section as the precedent for how a
  sub-capability gets refined after the fact.
- **Setup-guide precedent**: `docs/integrations/ksef/setup-guide.md` (capability table,
  prerequisites, troubleshooting table shape) and the KSeF/Subiekt tutorials from PR
  #1284 (screenshot-driven walkthrough structure).
- **README precedent**: `libs/integrations/erli/README.md` (adapter table, capabilities
  table, credentials/config JSON blocks, "Notable implementation details", doc links) —
  from the same in-flight PR #1284.
- **Source of truth for adapter behavior**: read directly from
  `InfaktInvoicingAdapter`, `InfaktWebhookTranslator`,
  `InfaktInboundWebhookDecoderAdapter`, `InfaktAdapterFactory`, and
  `infakt-connection.types.ts` on `1282-infakt-fe-plugin` rather than from the issue
  body alone, per the ADR-authoring rule to verify retrospective specifics against the
  actual implementation.
- **Webhook secret mechanics**: `WebhookSecretService.rotate` (OL always generates a
  random secret; there is no "set to a caller-supplied value" endpoint) and
  `CredentialsWebhookSecretAdapter` (secret stored at
  `webhook-secret:<connectionId>`) — this shaped the troubleshooting note about
  secret-mismatch being a known rough edge rather than a solved flow.

---

## 5. Questions & Assumptions

### Open Questions
- Whether inFakt's webhook-subscription UI lets an operator paste in a custom secret,
  or only displays one it generates itself. Not verifiable without live dashboard
  access in this session.

### Assumptions
- **Safe default**: document the flow as "generate in OL, paste into inFakt" (the more
  common HMAC-webhook UX), and add an explicit fallback note for the reverse case
  (copy inFakt's own generated secret into OL) plus a call-out that OL has no
  set-custom-value endpoint today — matches the project's "document known gaps, don't
  hide them" precedent (PR #1284 did the same for a discovered UI bug, #1287).

### Documentation Gaps
- None discovered beyond the webhook-secret-direction ambiguity above.

---

## 6. Proposed Implementation Plan

### Phase 1: Research
1. Read issue #1283, #1279 (epic), #1281 (webhook routing — code exists but PR open).
2. Read `InfaktInvoicingAdapter`, `InfaktWebhookTranslator`,
   `InfaktInboundWebhookDecoderAdapter`, `infakt-plugin.ts`,
   `infakt-adapter.factory.ts`, `infakt-connection.types.ts` on
   `1282-infakt-fe-plugin` for exact wire behavior.
3. Read the generic webhook ingress (`WebhookController`,
   `WebhookSecretService`, `CredentialsWebhookSecretAdapter`) to confirm the URL
   shape and secret-rotation mechanics.
4. Confirm the FE wizard's actual field labels (`infakt-setup-form.tsx`,
   `infakt-setup-page.tsx`) so the guide's field table matches the real UI.

### Phase 2: ADR
1. **File**: `docs/architecture/adrs/030-infakt-ksef-indirection.md`
   - **Action**: write per template — Context / Decision / Alternatives /
     Consequences / References, retrospective-authored (decision already merged
     across #1275/#1292/#1293), Status: Accepted, dated today.
   - **Acceptance**: matches template shape; under ~500 words in the prose sections;
     alternatives section lists ≥2 seriously-considered rejected options.
2. **File**: `docs/architecture/adrs/README.md`
   - **Action**: add the ADR-030 index row.
   - **Acceptance**: row present, links resolve.

### Phase 3: Setup guide + README
1. **File**: `docs/integrations/infakt/setup-guide.md`
   - **Action**: Capabilities table, Prerequisites, connection-creation walkthrough,
     webhook-configuration section (URL pattern, HMAC secret, verification handshake),
     verification walkthrough, troubleshooting table — each illustrated with the
     existing screenshots at `libs/integrations/infakt/docs/assets/`.
   - **Acceptance**: every referenced image path exists in the repo tree; field names
     match the real wizard.
2. **File**: `libs/integrations/infakt/README.md`
   - **Action**: adapter table, capabilities table, credentials/config JSON,
     implementation-detail bullets, doc links — mirrors `erli/README.md`.
   - **Acceptance**: matches the sibling-package README shape from PR #1284.

### Phase 4: Architecture overview
1. **File**: `docs/architecture-overview.md`
   - **Action**: add a "Second provider" paragraph for inFakt to § 14 Invoicing,
     immediately after the existing KSeF paragraph, linking ADR-030 and the new setup
     guide.
   - **Acceptance**: matches the acceptance-criteria wording quoted in issue #1283.

### Implementation Details

**New Components**: none — all changes are Markdown.

**Configuration Changes**: none.

**Database Migrations**: none.

**Events**: none.

**Error Handling**: N/A.

---

## 7. Alternatives Considered

### Alternative 1: Write the ADR as "Proposed" pending #1281's PR merge
- **Description**: mark ADR-030 `Proposed` until the registration/webhook PR (#1281)
  actually lands on `main`.
- **Why Rejected**: the decision itself (RegulatoryStatusReader-not-Transmitter, the
  webhook-as-shortcut design) already shipped in merged commits on #1292 and is stable
  regardless of when #1281/#1282 land — only the *host wiring* is still in flight, not
  the architectural decision this ADR documents. Every existing retrospective ADR in
  this repo is dated to when the underlying decision merged, not when every dependent
  PR lands.
- **Trade-offs**: none — `Accepted` is more accurate to what the ADR actually
  documents.

### Alternative 2: Target `main` directly and let the PR carry #1281/#1282's commits too
- **Description**: base this docs branch on `main` instead of stacking on
  `1282-infakt-fe-plugin`.
- **Why Rejected**: `main` doesn't yet have the inFakt plugin, webhook decoder, or FE
  at all — a setup guide describing a UI and webhook endpoint that don't exist on the
  target branch would be undiffable noise, and the PR diff would include ~30 unrelated
  commits from #1281/#1282. Stacking keeps this PR's diff to exactly the four docs
  files.
- **Trade-offs**: this PR can't merge to `main` until `1282-infakt-fe-plugin` does;
  GitHub will retarget it to `main` automatically once that happens (standard
  stacked-PR behavior).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ N/A — no code layer touched.

### Naming Conventions
- ✅ ADR filename follows `NNN-kebab-case-title.md`; setup guide follows the
  `docs/integrations/<provider>/setup-guide.md` convention already used by KSeF/Erli.

### Existing Patterns
- ✅ ADR structure, README structure, and setup-guide structure all mirror existing
  sibling docs (ADR-026, `erli/README.md`, `ksef/setup-guide.md`).

### Risks
- **Webhook-secret-direction ambiguity**: documented as a known gap in
  Troubleshooting rather than asserted as verified fact — see
  [Questions & Assumptions](#5-questions--assumptions).

### Edge Cases
- N/A (docs-only).

### Backward Compatibility
- ✅ Purely additive — no existing doc content removed or restructured other than the
  two-line ADR-index and architecture-overview insertions.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests / Integration Tests
- N/A — no code changes.

### Acceptance Criteria
- [x] ADR follows the template in `docs/architecture/adrs/README.md`
- [x] ADR status: `Accepted`
- [x] Setup guide covers the webhook URL and HMAC secret configuration steps
- [x] `docs/architecture-overview.md` updated with the inFakt provider entry
- [x] ADR index updated
- [x] Package README added

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — docs only)
- [x] Respects CORE vs Integration boundaries (N/A)
- [x] Uses existing patterns (ADR template, README precedent, setup-guide precedent)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [ADR-026](../architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [ADR-030](../architecture/adrs/030-infakt-ksef-indirection.md)
