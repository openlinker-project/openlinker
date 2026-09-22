# Pack bench & Assign Packing Work (manual + automated)

Verifies the two OMS staffing/fulfilment screens end to end: the **pack
bench** (`/bench`) and **Assign Packing Work** (`/fulfillment/assign`), per
[ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md)
and [ADR-074](../architecture/adrs/074-fulfillment-work-pre-assignment.md).
Companion to the [operator tutorial](../user-guide/10-pack-bench.md), which
explains what each screen is for — this file is the checklist for a
reviewer or QA pass.

A `FulfillmentWork` row has no HTTP creation endpoint — it only exists once
an order has been routed through the full OMS chain (a real `openlinker`
connection, an active inventory location, and a dispatch/accept handshake).
Both the automated specs and this manual checklist therefore need that chain
set up first — see **Prerequisites** below.

---

## 1. Automated specs

- **Pack bench**: `apps/e2e/tests/bench/pack-bench-redesign.spec.ts`
- **Assign Packing Work**: `apps/e2e/tests/bench/assign-packing-work.spec.ts`

Both seed `fulfillment_works` rows directly via
`apps/e2e/src/support/bench-seed.ts` / `assign-packing-work-seed.ts` (the
same documented raw-Postgres-seed exception `sales-document-market-seed.ts`
uses — see that file's own header), rather than driving the full order →
routing → dispatch chain live on every run.

### What the pack bench spec asserts

| `data-state` | What it seeds | What it asserts |
|---|---|---|
| `working` | An accepted, open, unpacked parcel | Order reference + buyer name render on opening the parcel |
| `ready` | Every line already fully scanned | Same — parcel content renders correctly at full completion |
| `hold` | A `fulfillment_holds` row placed on the parcel | The hold reason is visible on the open parcel |
| `unlabelled` | A closed parcel with a `shipments` row whose label attempt failed (`providerShipmentId` null) | The closed-parcel documents panel shows the "no label yet" state |
| `empty` | No accepted work, `sourcingAuthority` disabled on the OMS connection | The bench's **not-routed** message renders (the mockup's `empty` pill is labelled "Nothing routed") — the separate idle/pipe-healthy empty state has no mockup panel and is exercised only by the manual checklist below |
| `locked` | — (mockup screenshot only) | Not driven against the real app — see the spec's own header for why |

### What the Assign Packing Work spec asserts

- An unassigned task starts in the **Unassigned** lane.
- Using **Move to** moves it into the named packer's own lane.
- Toggling **self-serve eligible** off on an already-assigned task un-checks it.
- Placing a **hold** with a reason marks the row held.
- The assigned packer's OWN bench session then shows the **"Assigned to
  you"** badge for that parcel — the cross-surface round trip #3341 built.

---

## 2. Prerequisites (manual run)

Skip this section if you're only reading the automated coverage table above.

1. An `openlinker`-platform connection exists, is **active**, and has the
   **FulfillmentExecutor** capability enabled.
2. At least one active `inventory_locations` row exists (Settings → the
   location the connection routes to).
3. That connection's `sourcingAuthority` is enabled in its config, so
   OpenLinker's own router claims orders for it — see
   [Connecting a Platform](../user-guide/02-connecting-a-platform.md).
4. A packer account exists (role `packer`) you can sign into the bench with,
   separately from your own admin session.
5. At least one order has been routed and accepted, so a `FulfillmentWork`
   row exists to work with — place a real test order through a connected
   marketplace, or ask whoever set up the stack for a seeded one.

---

## 3. Manual checklist — pack bench (`/bench`)

- [ ] Sign into `/bench` directly (no redirect to `/login` — the bench
      renders its own sign-in form).
- [ ] With no accepted work anywhere: confirm the **idle-empty** message
      ("nothing to pack right now") — not the "routing isn't switched on"
      message, since routing IS configured per the prerequisites.
- [ ] With `sourcingAuthority` temporarily disabled on every OMS connection:
      confirm the bench instead shows the **"routing isn't switched on"**
      message, naming the settings page to fix it. Re-enable afterwards.
- [ ] With one accepted, unpacked parcel routed: open it from the worklist,
      confirm order reference, buyer name and line(s) render.
- [ ] Scan (or type) a line's barcode until its required quantity is met —
      confirm the line turns green and, on the LAST line, the parcel closes
      automatically with no separate "Close" button anywhere.
- [ ] Put a line on hold with a reason before completing it — confirm the
      hold reason is visible on the parcel and the parcel does not
      auto-close.
- [ ] Close a parcel for an order that has no shipping label yet — confirm
      the closed view shows the **unlabelled** panel instead of tracking
      info, with a reassurance that the box is correctly recorded.
- [ ] Leave the bench idle past the configured idle timeout — confirm it
      **locks and clears the session**, and that signing back in resumes
      correctly (any completed scans on the LAST parcel survive; the lock
      does not discard in-progress verification).

## 4. Manual checklist — Assign Packing Work (`/fulfillment/assign`)

- [ ] Sign in as **admin** or **operator** (this screen is not reachable by
      a plain `viewer` or `packer` role).
- [ ] Confirm the board renders one **Unassigned** lane plus one lane per
      packer, and every row shows a **Move to** select, a **self-serve**
      checkbox and a **Hold** button.
- [ ] Assign an unassigned task to a named packer via **Move to** — confirm
      it moves into that packer's lane immediately, with no separate save
      step.
- [ ] Confirm there is **no drag-and-drop** anywhere on this screen — the
      select is the only reassignment path, by design.
- [ ] Uncheck **"Anyone may claim this"** on an assigned task, then sign in
      as a DIFFERENT packer and confirm the bench shows that parcel as
      locked to the assigned packer (no Open button, a locked note instead).
      Re-check it and confirm the other packer can open it again.
- [ ] Place a hold with a reason on a task from this board — confirm the row
      shows a held indicator immediately.
- [ ] As the assigned packer, open their own bench worklist and confirm the
      reassigned parcel shows the **"Assigned to you"** badge — and that a
      parcel assigned to someone else shows **"Assigned to another packer"**,
      never that other packer's raw account id or email.

---

## See also

- [Operator tutorial: Pack Bench & Assign Packing Work](../user-guide/10-pack-bench.md)
- [ADR-053 — Fulfilment authority vocabulary leaf](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md)
- [ADR-054 — FulfillmentWork as the unit of assignment](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md)
- [ADR-074 — Fulfillment work pre-assignment](../architecture/adrs/074-fulfillment-work-pre-assignment.md)
