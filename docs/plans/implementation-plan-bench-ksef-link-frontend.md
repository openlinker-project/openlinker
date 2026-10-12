# Plan: bench shows the KSeF verification link instead of "Print" (#3649)

Frontend half of #3648 (PR #3722). Verified still reproducing: the bench web client had no `link` state and
offered Print for any invoice the backend called printable; a 409 from the print route showed a generic failure.

## Scope (apps/web, features/bench only)
1. **Transport**: `verificationUrl` on the invoice document and on the legacy invoice slot
   (`bench-parcel.schema.ts`, `bench-parcel.types.ts`); absent from an older API reads as `null`.
2. **Presenter**: new `invoice-link` card in `bench-sales-document.ts` (printable wins; then link; then not-printable);
   finished state, so no refetch. Legacy slot `state: 'link'` handled for an API older than #3646.
3. **Render**: invoice number + "Open invoice in KSeF" (`target="_blank"`, `rel="noopener noreferrer"`), never
   "Ready to print", no Print button. The URL is the backend's; the browser never builds it.
4. **409 on print**: `ApiError.isConflict()` shows the "no printable version" copy; any other failure keeps the
   generic message.
5. Copy in `bench-parcel.copy.ts` (passes `check-ui-vocabulary`).

## Non-goals
Receipt link (#3647, already shipped), OL-rendered PDF (#3620), any KSeF knowledge outside the copy string the
issue's acceptance criteria name.

## Dependency
Stacked on #3648's branch (adds the `link` state and `verificationUrl`); retarget to `main` once #3722 merges.

## Tests
Link card (href/target/rel, no Ready-to-print on the invoice card), legacy slot, renderer still prints, 409 vs other
failure; fixtures gain `verificationUrl: null`.
