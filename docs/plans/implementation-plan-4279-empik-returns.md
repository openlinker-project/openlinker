# Implementation plan: Empik returns (#4279)

Part of epic #4273, stacked on #4278.

## Design

`MiraklOrderSourceAdapter` implements `ReturnSourceReader` by delegating to
`MiraklReturnSource` (RT11, `GET /api/returns`, seek pages):

- `listReturnFeed`: closed `return_last_updated_from` / `_to` windows from an
  ISO cursor (orders feed rules: overlap, read lag, halving). Event key
  `{id}:{last_updated}`.
- `getReturn`: RT11 by `return_id`, plus OR11 for the order's lines (SKU,
  title, unit price), since RT11 lines carry none. Missing return: 404.
- `terminalRawStatuses`: `CLOSED`, `REFUSED`, `CANCELED`.
- Scheduler: returns poll every 15 minutes, status sync hourly (90-day
  lookback), both on by default with env gates.

RT11 parameters and fields are from Mirakl's documentation (RT11, RT12 read
2026-11-23); RT12 lists returnable lines and is not used. Staging accepts
RT11 but has no return yet, so the fixture waits for a real one.

## Tests

Unit: mapper (order lines, reason fallback, terminal states), return source
(window query, de-dup, order fallback, 404). Integration: E11 (poll, ingest,
attribution, lines) and E12 (re-read to a terminal state).
