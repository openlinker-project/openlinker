# Implementation plan - universal "send by email" for every sales document (#3550)

Epic G06 (#3510). Layer: CORE (invoicing, fiscalization) + Interface (API) + one port widening in `users`.
Priority P1. Decision D30 (send for every provider), D6 (a manual send is never blocked by the automatic
buyer-email toggle). Blocks #3551 (frontend dialog + timeline entries).

Stacked on #3548 (`IInvoiceAttachmentService`, the one answer to "what can I attach?"), which sits on #3620.
Base branch: `3548-ksef-document-url`.

## 1. Task understanding

`POST /invoices/:invoiceId/send-email` answers 501 for every adapter except inFakt (`InvoiceEmailSender`).
Make it work for every provider, add the same action for fiscal-receipt documents, add an editable recipient,
say who sent it ("Sent via", M24), and persist each send so the order timeline can show it.

### Non-goals
- The frontend dialog and timeline rendering (#3551).
- Order lifecycle emails to the buyer (#3554) and any automatic send.
- Sending from the worker: the manual send is an API call (see finding 2).

## 2. Findings that differ from the issue text

1. **`MailerPort` is not in `libs/core/src/mailer/`.** That context holds only the DB-backed SMTP *settings*.
   The port is `libs/core/src/users/domain/ports/mailer.port.ts` (`MAILER_TOKEN`), and it has **no attachment
   support** - `EmailMessage` is `{to, subject, text, html?}`. Attaching the PDF therefore needs an OPTIONAL
   `attachments` member added to the published port (source-compatible: an implementer ignoring it still
   compiles), and `SmtpMailerAdapter` passing it to nodemailer.
2. **`MAILER_TOKEN` is bound only in `apps/api`** (`AuthModule`), and `InvoicingModule` is also imported by the
   worker. A constructor injection would break worker boot, so the core service resolves the mailer lazily with
   `ModuleRef.get(MAILER_TOKEN, { strict: false })` (the `InvoiceService` -> fiscalization precedent and the
   automation `send-email` executor's `AutomationDelegateResolverService`). Absent -> a named refusal
   (`mailer-unavailable`), never a crash. The manual send is an API request, so the mailer is bound there.
3. **The provider path cannot take a recipient.** `SendInvoiceByEmailCommand` has no recipient field and its
   result says "no override input". So the provider (inFakt) is used first only when the operator did not change
   the address (absent, or equal to the buyer's stored email); an edited recipient is sent by OpenLinker's own
   mailer, because honouring the operator's address beats the "provider first" preference, and the response says
   `sentVia: 'openlinker'`.
4. **There is no persisted event to put on the timeline.** `order-activity-timeline.tsx` composes from separate
   reads; there is no email event anywhere. A new table records each send.
5. `OrderRecord.buyerEmail` already exists (typed read of `orderSnapshot.customerEmail`, `undefined` under
   `OL_STORE_PII=false`), so no snapshot-layout knowledge leaks.

## 3. Design

### 3.1 Port widening (`users`)
`EmailMessage.attachments?: readonly EmailAttachment[]` with `{ filename, content: Uint8Array, contentType }`.
`SmtpMailerAdapter` maps it to nodemailer; `DbBackedMailerAdapter` forwards the message untouched;
`ConsoleMailerAdapter` logs names and sizes, never bytes.

### 3.2 `IInvoiceEmailService` (core, invoicing)
`sendInvoiceEmail({ invoiceId, recipient?, locale?, sendCopy?, actorUserId })` returns a discriminated result:
`sent { sentVia, recipient, deliveryId }` or `refused { reason }` with a CLOSED reason union (the #2231 rule):
`invoice-not-found`, `not-issued`, `document-not-ready` (attachment `waiting`), `no-document` (attachment `none`,
actionable), `no-recipient`, `invalid-recipient`, `mailer-unavailable`, `send-failed`.
Steps: load record -> recipient (explicit, else `order.buyerEmail`; validated server-side) -> if the adapter has
`InvoiceEmailSender` and the recipient is not overridden, use it (`sentVia: 'provider'`) -> else resolve the
attachment: `pdf` attaches bytes, `link` goes in the body, `waiting` / `none` refuse -> `MailerPort.sendEmail`
(`sentVia: 'openlinker'`) -> persist the outcome. **Never reads the connection's automatic buyer-email toggle** (D6).
A provider or mailer failure is recorded as `failed` with a stable code and never returns the raw message
(Redis/SMTP messages carry hosts and credentials).

### 3.3 Receipts (core, fiscalization)
`IFiscalReceiptEmailService` beside it, same result shape. A receipt whose registration is not `registered`
(mockup: the link exists only after `CONFIRMED`) refuses with `document-not-ready`. Body = OpenLinker's summary (number, date, total) plus
the `link` artefact of the registration (the e-receipt at the vendor). It states the summary is not the receipt.
No attachment. A registration with no link artefact refuses with `no-document`.

### 3.4 Persistence
New table `document_email_deliveries` (migration): `id`, `internalOrderId`, `documentKind` (`invoice` |
`fiscal-receipt`), `documentId`, `sentVia`, `outcome` (`sent` | `failed`), `failureCode`, `recipient` (stored only
when `OL_STORE_PII` is on, else null), `actorUserId`, `createdAt`. Index on `(internalOrderId, createdAt)`.
No FKs (the `order_changes` / `refund_records` precedent). Read through `IDocumentEmailDeliveryService.listForOrder`.

### 3.5 API (`apps/api`)
- `POST /invoices/:invoiceId/send-email`: DTO gains `recipient`; response `{ delivered, recipient, sentVia }`;
  501 is gone. `@Roles('admin')` unchanged (the issue's "invoices:write").
- `POST /fiscal-registrations/:id/send-email`: new, same DTO minus `locale`, `@Roles('admin')`.
- `GET /orders/:orderId/document-emails`: outcome list for the timeline, `@Roles('admin','operator','viewer')`,
  carrying no recipient.
- Refusals map to named HTTP codes (404 / 409 / 422 / 502 / 503) and carry BOTH a machine `code` and a readable
  English `message`: mockup M24 note 9 / AC G06-05 say the dialog shows the server's own message (its example is
  "no document to attach"), so the sentence is the backend's. The frontend branches on `code`, never on the text,
  and the message never carries a raw provider or SMTP error (finding on credentials in messages).

## 4. Steps
1. Port widening + SMTP/console/db adapters (+ specs).
2. `document_email_deliveries`: ORM entity, migration, repository port + repository, service, tokens, barrel.
3. `InvoiceEmailService` (+ spec: resolvable doc, edited recipient, buyer emails off, nothing resolvable, provider
   first, provider skipped on override, mailer absent, failure recorded).
4. `FiscalReceiptEmailService` (+ spec).
5. Controllers, DTOs, exception mapping (+ controller specs).
6. Migration parity / int-spec for the delivery table; `check:invariants`.
7. `docs/architecture-overview.md` bullet.

## 5. Open questions
1. Widening `MailerPort` is a published-port change in `users`; confirm it is acceptable (optional member, no break).
2. Recipient override with inFakt falls back to OpenLinker's mailer (finding 3). Acceptable, or should the override
   be refused for provider-first connections?
3. `recipient` persisted only under `OL_STORE_PII=true`. Is hashing it instead preferable?
4. **Mockup M24 read** (artifact `CRZZbMEZY3RLFDJD4BGuP4`): it carries notes only, no dialog copy, state names or
   `data-testid`s. What it fixes: recipient pre-filled from `orderSnapshot.customerEmail` with a "Masked Allegro
   address" badge, empty and required under `OL_STORE_PII=false`; a "Sent via" line naming the sender (provider
   first, OpenLinker mailer as fallback; always the mailer for KSeF and Subiekt); the dialog shows the server's literal
   message; only admins send or retry; three NEW persisted timeline entries ("Invoice emailed to buyer", "Email to
   buyer failed", plus the upload one from #3549); a receipt has no send route today and its link exists only after
   status `CONFIRMED`; the worker has no `MailerPort` (retries and automations, G06-06, out of scope here).
5. Receipts: a registration with no `link` artefact refuses; is a summary-only email wanted instead?
