# Implementation Plan — #2711: `automation-dispatch-boot` HARD GATE is red on `oms-programme-wave-3a`

## 1. The failure and its cause

`apps/worker/test/integration/automation-dispatch-boot.int-spec.ts:51` asserts:

```ts
expect(dispatcher).toBeInstanceOf(AutomationDispatchService);
```

`AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to `AutomationIrreversibleGateService`
(`automation.module.ts`, from #2362). Only that identity assertion fails; the other three
tests in the file pass.

## 2. The judgement: identity vs behaviour

**#2362's binding is correct and must not be reverted.** Verified by reading the service:
`AutomationIrreversibleGateService` **decorates** `AutomationDispatchService` —

- it takes `AutomationDispatchService` as a concrete constructor dependency;
- it partitions matched rules via the pure `gateIrreversibleAutomationActions`;
- it hands **every survivor** to `this.dispatcher.dispatch(...)` unchanged
  (`automation-irreversible-gate.service.ts:96`), skipping the call only when the survivor
  set is empty (which would be a no-op iteration anyway);
- blocked rules are recorded through the same `AUTOMATION_RUN_RECORDER_TOKEN` seam.

It does not swallow survivors. `automation.module.ts` already documents this intent in a
comment beside the binding. So the gate's **intent** ("the real dispatcher, not an inert
placeholder") still holds; its **assertion** is a stale proxy — it tests class identity
where the property defended is behavioural.

**Resolution: replace the identity assertion with a behavioural one.** Rejected
alternatives, each of which would leave a gate defending nothing (the "check that cannot
fail" class, #2673/#2589/#2393):

- `toBeInstanceOf(Object)` / deleting the assertion — passes for a placeholder.
- `toBeInstanceOf(AutomationIrreversibleGateService)` — a class merely having the right
  name satisfies it; an inert gate would pass.

## 3. The change

One file: `apps/worker/test/integration/automation-dispatch-boot.int-spec.ts`.

Replace the single identity test with two behavioural tests, both driving the **real
container-resolved** `AUTOMATION_DISPATCH_SERVICE_TOKEN` and observing through a `jest.spyOn`
on the container's `AUTOMATION_RUN_RECORDER_TOKEN` singleton (`mockResolvedValue(undefined)` —
so no `automation_runs` row is written and no FK on a non-existent rule is needed).

1. **`dispatches a surviving rule through the REAL dispatcher, not an inert placeholder`**
   One matched rule carrying `issue-sales-document`. With one rule there is no collision, so
   it must survive the gate and reach the dispatcher. Assert `record` was called once, with
   `outcome !== 'blocked'` and a **non-empty `steps`** array — steps only exist if the
   dispatcher's `runRule` loop actually ran.
   *An inert placeholder records nothing → red.*

2. **`blocks colliding irreversible rules — the gate is composed in, not bypassed`**
   Two matched rules both carrying `issue-sales-document`. Assert `record` called twice, each
   with `outcome === 'blocked'` and `steps` empty.
   *A bare `AutomationDispatchService` binding (gate bypassed) would run both → red.*

Test 1 asserts the **positive** fact — exactly one step, whose `action` is
`issue-sales-document` — rather than only `outcome !== 'blocked'`, so it reads as a claim about
what ran instead of as the absence of one.

`issue-sales-document` is chosen deliberately: it resolves to `UnavailableActionExecutorService`
in this build, so the step is deterministic and side-effect-free — no mailer, no relay, no
outbound call — while still proving the dispatcher body executed.

Supporting edits in the same file:
- drop the now-unused `AutomationDispatchService` import (avoids `TS6133`, which would present
  as a false pass with `Tests: 0 total`);
- add a local `issueDocumentRule(id)` fixture. It needs **no casts at all**: `EmptyTriggerConfig`
  (`Record<string, never>`) is a member of the `AutomationTriggerConfig` union, so the plain `{}`
  that `order.packed` carries type-checks directly — the unit spec's `{} as never` is not
  reproduced here, and A1 is parameterless (`{ action: 'issue-sales-document' }`);
- `afterEach` restores the spy;
- **explicit type parameters on every `harness.get`** — `get<T = any>(token): T` defaults to
  `any`, which yields an untyped spy whose `mock.calls[0][0]` is `any`: the shape that lets a
  *wrong* assertion type-check, which on a hard gate is the failure being fixed. Both
  `IAutomationDispatchService` and `IAutomationRunRecorderService` are exported from the
  `@openlinker/core/automation` barrel, so no deep import is needed;
- update the file docblock so it still states the property defended, and update the test titles
  to name *behaviour* rather than a class.

**No production code changes. No migration.**

## 4. Docs

`docs/architecture-overview.md` § Automation, line 508, already states that the token "resolves
to `AutomationIrreversibleGateService`, which partitions the matched set ... and hands the
survivors to `AutomationDispatchService`". That is exactly the composition the new tests assert,
so **no doc amendment is required**. No production behaviour changes, so no ADR.

The docblock of the spec itself carries the finding a future reader needs: an identity check
could not survive a legitimate decoration, which is what happened here, and it is what stops
someone "fixing" this back to `toBeInstanceOf` the next time a decorator lands.

## 5. Red-first proof, in BOTH directions (required, not optional)

The pair is only worth having if each half is falsifiable, so both are proven by temporarily
rebinding `AUTOMATION_DISPATCH_SERVICE_TOKEN` in `automation.module.ts`:

1. **Inert placeholder** (`useValue: { dispatch: () => Promise.resolve() }`) → **test 1 must
   fail** on "recorder never called".
2. **Gate bypassed** (`useExisting: AutomationDispatchService`) → **test 2 must fail** because
   both colliding rules actually ran.

Each red must be a real `Tests: N failed` assertion failure — **not** a `TS6133` compile red
with `Tests: 0 total`, which is a false pass.

**The rebinding reaches the test from SOURCE, not from `dist`.**
`apps/worker/test/jest-integration.cjs:29-30` maps `^@openlinker/core/(.*)$` to
`libs/core/src/$1`, so no `pnpm -r build` is needed for the experiment and inspecting
`libs/core/dist` would prove nothing. (A `libs` build *is* needed once per fresh worktree for
`@openlinker/test-kit`'s `dist`, which the Jest `globalSetup` loads as real build output.)

**Revert and verify, then re-run green.** `git diff --stat` must show `automation.module.ts`
untouched before commit, and the **final green run happens after the revert** — a green
recorded before a revert is not evidence about the shipped tree. Leaving the experimental
rebinding in a shipped commit would re-red the exact hard gate this issue exists to fix.

## 6. Gates

`pnpm lint` (0 errors), `pnpm type-check`, `pnpm test`, and the **worker** integration suite
explicitly (root `test:integration` is `@openlinker/api` only, #2670), running this spec via
`--runTestsByPath`. Known pre-existing and not chased: #2638, #2639, and the
`inventory-location-propagation-e2e` salt gap (#2670).
