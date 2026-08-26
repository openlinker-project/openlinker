/**
 * Automation Dispatch Service Interface (#2360, the seam #2361/#2362 implement)
 *
 * What happens once a rule has been decided to fire. Declared here, with an
 * inert implementation, so that #2362's at-most-one gate and #2361's six
 * executors arrive as a PROVIDER SWAP rather than as a change under a live
 * caller — the `EmptyReservationLedgerReader` precedent (#2321).
 *
 * **A service interface, not a `*Port`.** #2362 places its implementation in
 * `automation/application/services/**` — the same context and the same layer
 * family — so a `*Port` name would assert a hexagonal boundary that does not
 * exist. (`EmptyReservationLedgerReader` earned its port name by crossing to a
 * future EXTERNAL reader; this does not cross anything.)
 *
 * **The at-most-one gate for irreversible actions is the IMPLEMENTOR's job,
 * not the caller's** (spec §5.5 divergence 3). This interface deliberately
 * accepts EVERY matched rule, including several carrying A1/A2: collapsing them
 * before the gate sees them would move the money decision into the emitter,
 * where the dry run cannot show it and #2362's `blocked` outcome could never be
 * reported.
 *
 * @module libs/core/src/automation/application/interfaces
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5
 */
import type { AutomationRule } from '../../domain/entities/automation-rule.entity';
import type { AutomationSubjectFacts } from '../../domain/types/automation-facts.types';
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';

export interface AutomationDispatchInput {
  readonly trigger: AutomationTrigger;
  readonly facts: AutomationSubjectFacts;
  /** Every rule that matched, in evaluation order. May contain several irreversible-action rules. */
  readonly matchedRules: readonly AutomationRule[];
  /** The emitting caller's instant. Never read from a clock below this line. */
  readonly now: Date;
}

export interface IAutomationDispatchService {
  dispatch(input: AutomationDispatchInput): Promise<void>;
}
