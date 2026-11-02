# Implementation Plan: Batch issuing screen (#3584, epic #3515)

## Goal

Give an admin the M15 batch-issuing screen for one connection: its kind-scoped
schedules (#3582), the queue of orders waiting for the next run, a live view of
a run in progress, run history with per-order outcomes, and the empty and
provider-unavailable states. Reach it from the "Connected providers" row when a
kind issues in batches.

Classification: Frontend, with a small Interface/Core read widening.

Non-goals: new run semantics (#3583 owns them), E2E and mockup baselines
(#3585), a schedule editor outside this screen.

## Decisions

- **Mockup M15 is updated to match the backend and committed with this issue**
  (`docs/plans/mockups/oms-mvp/m15-batch-issuing.html`): one schedule per
  document kind (invoice, fiscal receipt), each with its own time zone
  (default Europe/Warsaw); the month-end note states D42 (B2B on the last day,
  B2C in a daily 23:00 run) instead of leaving the question open; "Run now"
  issues the whole queue.
- **Route**: `/settings/sales-documents/batches/:connectionId`, admin-only like
  its parent page. The "Configure" link sits in the provider row's "When it
  issues" cell and appears only when at least one kind on that row is
  `batched` (M15 note 1).
- **"Blocked" on the Next batch tab** is the latest finished run's items that
  were not enqueued (`blocked`, `already-documented`, `not-routed-here`,
  `indeterminate`), shown with their reason. The queue itself holds only
  orders still waiting; an order the gate blocked for another reason has left
  it, so the screen shows it from the run record instead of letting it vanish
  (the mockup's own promise). Filtering is local, like the orders table.
- **Running view**: progress is items recorded so far over items recorded plus
  orders still queued; the overview is polled every 5 s while a run is in
  progress and the run detail is re-read with it.
- **Unavailable**: the connection's own status (`needs_reauth`, or not
  `active`) drives the error alert, disables "Run now" and links to the
  connection. The queue stays visible.
- **Schedules are written through the connection config** like the trigger
  model: `salesDocument.batchSchedules[kind]`, via the existing
  fetch-fresh-then-merge mutation. Validation mirrors `readBatchSchedule`
  (HH:MM, every 1-24 hours, IANA zone checked with `Intl`).

## Backend widening (read only)

Rows need what the mockup shows: order number, buyer and the document number.

1. `SalesDocumentBatchQueueEntry` gains `orderNumber`, `buyerName` (from the
   snapshot; null when absent or PII storage is off).
   `SalesDocumentBatchRunRepository.listQueue` selects `orderSnapshot`.
2. `SalesDocumentBatchRunItemView` gains `orderNumber`, `buyerName`,
   `documentNumber`. The repository adds `findOrderLabels(orderIds)`; the
   service reads the document number from the view it already loads.
3. DTOs in `apps/api/src/sales-documents/http/dto/sales-document-batch.dto.ts`
   and the controller mapping; specs updated.

## Frontend steps

1. `features/sales-documents/api/sales-document-batch.{types,api,query-keys}.ts`
   and wire into the api client.
2. Hooks: overview (polls while running), queue (all pages up to a cap), runs,
   run detail, start-run mutation (409 codes mapped to copy), save-schedule
   (extends `SalesDocumentConfigPatch` with `batchSchedule`).
3. `lib/batch-schedule-form.ts` (form <-> config, validation),
   `lib/describe-batch-run.ts` (run status label/tone, result summary, item
   outcome copy), `lib/batch-issuing.copy.ts`.
4. Components: `sales-document-batch-screen.tsx` (tabs Schedule / Next batch /
   Run history, unavailable alert), `batch-schedule-tab.tsx`,
   `batch-queue-tab.tsx` (chips, Run now, running panel, empty state),
   `batch-run-history-tab.tsx` (table + details with metrics).
5. Page + route; "Configure" link in `sales-documents-panel.tsx`.
6. Tests: lib unit tests; screen states (settings, queue, running, finished,
   empty, unavailable); panel link only when batched.

## Risks

- A queue larger than the fetch cap: the count comes from the overview, and
  the table says "showing N of M".
- PII off: buyer is "—", same as the orders list.
