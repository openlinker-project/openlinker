/**
 * Automation Trigger Firing Repository Port (#2360, Wave-2 spec §5.2 + §7.2)
 *
 * The persistence contract for `automation_trigger_firings` — the durable
 * at-most-once record behind every `deadline-sweep` trigger. #2358 shipped the
 * table and the entity and deliberately left the writer to this issue.
 *
 * ## One method, and the absence of a read method is the design
 *
 * `claim` is a CONDITIONAL INSERT reporting whether THIS caller won — the
 * `markPacked` / `claimWaybillRelay` shape — never a read followed by a write.
 * A `hasFired()` read would be irresistible to a caller and would reintroduce
 * exactly the race the unique index exists to close: two sweeps observing "not
 * fired", both proceeding, and on a T4 rule wired to A2 that is two labels
 * bought with real money for one order.
 *
 * So there is nothing here to read with. A caller that wants to know whether a
 * pair already fired asks by trying to claim it.
 *
 * @module libs/core/src/automation/domain/ports
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2, §7.2
 */
import type { AutomationRunSubjectKind } from '../types/automation-run.types';

export interface AutomationTriggerFiringClaim {
  readonly ruleId: string;
  readonly subjectKind: AutomationRunSubjectKind;
  readonly subjectId: string;
  /** The instant to record. Supplied by the caller — this layer never reads a clock. */
  readonly firedAt: Date;
}

export interface AutomationTriggerFiringRepositoryPort {
  /**
   * Record that this rule fired for this subject, at most once ever.
   *
   * Returns `true` when this call created the record (the caller may proceed to
   * dispatch) and `false` when one already existed (the caller must NOT
   * dispatch). Never throws on the conflict — a losing claim is the ordinary,
   * expected outcome on every sweep after the first.
   */
  claim(input: AutomationTriggerFiringClaim): Promise<boolean>;
}
