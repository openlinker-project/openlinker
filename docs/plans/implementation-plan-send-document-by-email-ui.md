# Implementation plan: universal "send by email" UI (#3551)

Frontend half of #3550. Layer: Frontend (`apps/web`). Stacked on `3550-send-document-by-email-top`.

## Scope
- One neutral `SendDocumentEmail` control (`features/orders/components`) mounted in `SalesDocumentPanel` for issued invoices (any provider) and registered fiscal receipts. Recipient field (empty = the order's own address, so no buyer PII is read client-side), language select, "Sent via" line, server refusal rendered verbatim.
- Admin-only (`useIsAdmin`): both routes are `@Roles('admin')`.
- Receipt: note that the mail carries OpenLinker's summary plus the link to the legal e-receipt.
- inFakt's private copy of the control is removed from its plugin section.
- Order Activity timeline gains "Invoice/Receipt emailed to buyer" and "Email to buyer failed" from `GET /orders/:orderId/document-emails`, injected through the existing `extraEvents` channel (the notes/returns precedent).

## Data layer
- `SendInvoiceEmailInput.recipient`, `SendInvoiceEmailResult.sentVia`.
- `fiscalization.api.sendEmail` + `useSendReceiptEmailMutation`.
- `orders.api.listDocumentEmails` + `useOrderDocumentEmailsQuery` + `mapDocumentEmailsToEvents`.

## Non-goals
- Retry/automation of sends (G06-06), worker-side mailer.
- Literal `data-testid` parity with mockup M24 (the file is not in the repo).

## Tests
`send-document-email.test.tsx` (invoice, receipt, refusal verbatim, non-admin renders nothing), `document-email-timeline-events.test.ts`, existing orders/pages suites green.
