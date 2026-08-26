/**
 * Automation Dispatch Gate DI Integration Test (#2362)
 *
 * Asserts against a really-booted Nest graph that
 * `AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to #2362's at-most-one gate, and
 * that `AutomationDispatchService` is still constructible as the gate's
 * delegate.
 *
 * **This exists because DI wiring is invisible to the compiler.** The whole
 * feature is one `useExisting` line: drop it and every unit test in
 * `libs/core` still passes, `pnpm type-check` still passes, and two rules both
 * buying a shipping label reaches production. `AutomationModule` is imported by
 * `apps/api/src/app.module.ts`, so this harness already boots it — the token
 * read below is the cheapest true statement about the binding.
 *
 * @module apps/api/test/integration
 */
import {
  AUTOMATION_DISPATCH_SERVICE_TOKEN,
  AutomationDispatchService,
  AutomationIrreversibleGateService,
  type IAutomationDispatchService,
} from '@openlinker/core/automation';

import {
  getTestHarness,
  IntegrationTestHarness,
  teardownTestHarness,
} from './setup';

describe('Automation Dispatch Gate DI', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should resolve AUTOMATION_DISPATCH_SERVICE_TOKEN to the irreversible-action gate', () => {
    const dispatcher = harness
      .getApp()
      .get<IAutomationDispatchService>(AUTOMATION_DISPATCH_SERVICE_TOKEN);

    expect(dispatcher).toBeInstanceOf(AutomationIrreversibleGateService);
  });

  it('should keep AutomationDispatchService constructible as the gate delegate', () => {
    // The gate composes over it rather than replacing it, so removing it from
    // `providers` breaks the gate's own construction rather than merely
    // orphaning a class.
    const delegate = harness.getApp().get(AutomationDispatchService);

    expect(delegate).toBeInstanceOf(AutomationDispatchService);
  });

  it('should interpose the gate rather than expose the dispatcher directly', () => {
    // Not merely "these are different objects" — the two `toBeInstanceOf`
    // assertions above already entail that. What matters is that the token's
    // `dispatch` is the GATE's, so every caller passes through the
    // at-most-one partition before any rule reaches an executor.
    const dispatcher = harness
      .getApp()
      .get<IAutomationDispatchService>(AUTOMATION_DISPATCH_SERVICE_TOKEN);
    const delegate = harness.getApp().get(AutomationDispatchService);

    expect(dispatcher.dispatch).not.toBe(delegate.dispatch);
    expect(Object.getPrototypeOf(dispatcher)).toBe(
      AutomationIrreversibleGateService.prototype,
    );
  });
});
