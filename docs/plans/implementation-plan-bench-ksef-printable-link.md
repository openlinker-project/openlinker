# Plan: bench must not report KSeF invoices as printable (#3648)

Verified still reproducing on main e8e407047: `canRenderDocument` = `accepted` + `isRegulatoryDocumentReader`;
KSeF implements the reader but throws `UnsupportedRegulatoryDocumentKindError` for `rendered`; the bench print
route does not catch it -> 500.

## Design
1. **Core (invoicing port)**
   - `RegulatoryDocumentReader.supportedRegulatoryDocumentKinds?()` - optional hint (ADR-046 probe-not-trust).
     Absent = "assume every kind" so inFakt / Subiekt / out-of-tree plugins are unchanged.
   - Pure helper `supportsRegulatoryDocumentKind(adapter, kind)`.
   - New sub-capability `RegulatoryVerificationLinkReader.getVerificationLink(record) -> {url} | null` + guard.
2. **KSeF** declares `['confirmation']` and implements `getVerificationLink`: KOD I
   `https://{qr host}/invoice/{seller NIP}/{P_1 as DD-MM-YYYY}/{base64url SHA-256 of the persisted FA(3) XML}`.
   The issue text says `/client-app/invoice/...`; MF's own docs (CIRFMF/ksef-docs kody-qr.md) have no `/client-app`.
   `P_1` is read from the XML itself (no timezone guesswork). Not `accepted`, no stored XML, or no `P_1` -> `null`.
   Environment arrives through adapter options (factory already resolves it).
3. **Bench (apps/api)**: printability asks the same question as the route (`supportsRegulatoryDocumentKind(…, 'rendered')`);
   print route 409s (existing message) and also maps `UnsupportedRegulatoryDocumentKindError`; documents view adds the
   link: legacy `invoice.state: 'link'` + `verificationUrl`, and `document.verificationUrl` on the invoice arm.
4. **Non-goals**: frontend (#3649), OL-rendered PDF (#3620), register route (already maps 409).

## Tests
Core helper/guard specs; KSeF fixture XML -> known hash -> known URL, per env, not-accepted -> null; bench service
spec (KSeF not ready, link arm, inFakt-style stays ready); controller 409.
