/**
 * Automation Irreversible-Action Gate Service Interface (#2362)
 *
 * **This interface adds no members, and that is the whole of it.** The gate's
 * outward contract IS the dispatch seam — it is bound to
 * `AUTOMATION_DISPATCH_SERVICE_TOKEN` and every caller resolves it as an
 * `IAutomationDispatchService`. Naming it separately would be ceremony if the
 * file existed for its own sake.
 *
 * It exists because `scripts/check-service-interfaces.mjs` derives the expected
 * interface filename from the SERVICE file's basename, so a second
 * implementation of an already-declared `I*Service` in the same context has no
 * file to point at — `automation-dispatch.service.interface.ts` is
 * `AutomationDispatchService`'s by that rule. The script's own docblock states
 * the looser rule ("an `I*Service` interface that has a sibling
 * `*.service.interface.ts` file **in the same context**"), which this
 * arrangement satisfies either way; reconciling the two is a shared-script
 * change and deliberately not made from this branch.
 *
 * Extending rather than re-declaring `dispatch` is what keeps that honest: if
 * the seam's signature changes, this file cannot drift from it.
 *
 * @module libs/core/src/automation/application/interfaces
 * @see {@link IAutomationDispatchService} — the contract this is, unchanged
 */
import type { IAutomationDispatchService } from './automation-dispatch.service.interface';

export type IAutomationIrreversibleGateService = IAutomationDispatchService;
