# Implementation plan — order-detail returns panel (#2640) + return activity timeline (#2646)

## Scope

Two FE surfaces, one PR. They share the returns barrel and the orders barrel, and shipping them
apart would mean two consecutive edits to both.

### #2640 — order-detail returns panel

1. **Core** — `ReturnListFilter.internalOrderId?: string`; a repository arm in
   `buildFilterPredicate` (`r."internalOrderId" = :internalOrderId`). Additive: an absent field
   does not filter (rule 1 of `return-query.types.ts`), so it composes with every other arm.
   It is deliberately independent of `bucket`: an `internalOrderId` filter necessarily selects
   attributed returns, but it is not a translation of `bucket: 'attributed'` — the #2378
   `orphans`/`bucket` conflation is the mistake being avoided.
2. **API** — `ListReturnsQueryDto.internalOrderId` (`@IsOptional() @IsString()`, NOT `@IsUUID`:
   an internal id is `ol_return_*`-style, minted by `formatInternalId`, never a bare uuid);
   threaded into the controller's `scope` so all four count reads see it.
3. **FE api** — `ReturnFilters.internalOrderId?: string` + `buildQuery` arm.
4. **Panel** — `features/orders/components/order-returns-panel.tsx`, mounted on
   `order-detail-page.tsx`. Reads `useReturnsQuery({ internalOrderId }, { limit })` from the
   returns barrel and renders `ReturnStageCell` per row — which is where the `restock_blocked`
   badge already lives, so the sentence is byte-identical **by component reuse**, one step
   stronger than importing the copy constant.
5. **Three distinguishable states, never collapsed**: loading, error (the read failed — say so,
   never "no returns"), and confirmed-empty. `envelopeUnreadable` is an error, not an empty.

### #2646 — return-detail activity timeline

1. **Core** — `ReturnRepositoryPort.findTimelineEntriesForReturn(returnId)`, and one shared
   private row→entry projection used by both reads so the two cannot drift. New header kind
   `matched` (from `matchedAt`/`matchedByUserId`), which the ORDER timeline gains too — one
   vocabulary, not two.
2. `IReturnsService.listReturnEventsForReturn(returnId)` — resolves connection names the same
   way the order read does. Works for an orphan by construction: it keys on `returnId`.
3. **API** — `GET /returns/:returnId/events`, declared BEFORE `@Get(':returnId')`… it is not a
   literal-vs-parameter collision (different depth) but the refund composition is identical, so
   it reuses the same fan-out over `getRefundsForReturn`. Same `@Roles('admin','operator','viewer')`
   posture as `/returns/events` — it carries the same refund `amount`/`currency`.
4. **FE** — `useReturnEventsQuery(returnId)`; `ReturnActivityTimeline` in `features/returns`
   rendering `mapReturnEventsToTimeline(entries, sessionUserId)`.
5. **Renderer reuse** — extract the presentational `<ol>` out of `OrderActivityTimeline` into
   `features/orders/components/activity-timeline-list.tsx`, exported from the orders barrel.
   `TimelineEvent` stays owned by orders (its docblock's stated ownership), and returns already
   holds that barrel edge. The order timeline's caption stays on the order timeline.
6. **Mapper** — `resolveBy` gains: a `record_status` entry that carries an `actorUserId`
   attributes to you / another operator; otherwise the existing source-claim rule. `matched` is
   the only such kind today. `resolveTitle` gains a `matched` case; `RETURN_TIMELINE_COPY` gains
   `matched`.
7. **Page** — mounted on `return-detail-page.tsx`, with a page-level test asserting it is on the
   page (docs/lessons.md § "is this MOUNTED?").

## Deliberately out of scope

- `credit note issued` stays deferred (#2383's ruling — `invoicing` / `order_changes`).
- ~~`authorizedAt` / `closedAt` timeline entries~~ — **reversed during review, and both ship.**
  The original reasoning ("#2383 chose `opened` + `declined`") does not carry once the same change
  widens that very vocabulary with `matched`: the four header timestamps are independent facts
  (ADR-060), `authorizedAt` has a real writer (`claimAuthorizedAt`, #2372), and emitting three of
  four would have been an arbitrary line. `closed` is declared and written by nothing today —
  stated in the repository rather than implied reachable.
- No new permission value; no write affordance is added by either surface.
